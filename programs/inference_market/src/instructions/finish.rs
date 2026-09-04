use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CloseEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::PERMISSION_SEED;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

use crate::errors::MarketError;
use crate::instructions::permissions::permission_exists;
use crate::logic::check_transition;
use crate::state::*;

#[commit]
#[derive(Accounts)]
pub struct FinishJob<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,
    #[account(mut, seeds = [JOB_SEED, job.requester.as_ref(), &job.nonce.to_le_bytes()], bump = job.bump)]
    pub job: Account<'info, Job>,
    #[account(mut, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
    /// CHECK: permission PDA for job.
    #[account(mut, seeds = [PERMISSION_SEED, job.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub job_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA for job_private.
    #[account(mut, seeds = [PERMISSION_SEED, job_private.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub job_private_permission: UncheckedAccount<'info>,
    /// CHECK: fixed.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: base escrow PDA; only its key is used, for the scheduled action.
    #[account(seeds = [ESCROW_SEED, job.key().as_ref()], bump)]
    pub job_escrow: UncheckedAccount<'info>,
    /// CHECK: Provider PDA of job.provider (validated in handler; any key when unclaimed).
    pub provider_account: UncheckedAccount<'info>,
    /// CHECK: validated == job.requester.
    pub requester_wallet: UncheckedAccount<'info>,
    /// CHECK: validated == job.provider, or == job.requester when unclaimed.
    pub provider_wallet: UncheckedAccount<'info>,
    /// CHECK: destination program for the action.
    #[account(address = crate::ID)]
    pub program_id: UncheckedAccount<'info>,
}

pub fn run(ctx: Context<FinishJob>, to: JobStatus, schedule_action: bool) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let signer = ctx.accounts.signer.key();

    // Authorization
    match to {
        // Normally requester-only. Once a Submitted job is AUTO_APPROVE_SECS past
        // its deadline, approval becomes permissionless: otherwise a requester who
        // never comes back locks the escrow forever, since no other transition out
        // of Submitted exists.
        JobStatus::Approved => {
            let job = &ctx.accounts.job;
            let auto_approvable = job.status == JobStatus::Submitted
                && now >= job.deadline_unix.saturating_add(AUTO_APPROVE_SECS);
            if !auto_approvable {
                require_keys_eq!(signer, job.requester, MarketError::Unauthorized);
            }
        }
        JobStatus::Rejected | JobStatus::Cancelled => {
            require_keys_eq!(signer, ctx.accounts.job.requester, MarketError::Unauthorized);
        }
        JobStatus::Expired => {}
        _ => return err!(MarketError::InvalidTransition),
    }

    // Pass-through account validation for the action
    let job_ro = &ctx.accounts.job;
    require_keys_eq!(
        ctx.accounts.requester_wallet.key(),
        job_ro.requester,
        MarketError::WrongRecipient
    );
    if job_ro.provider != Pubkey::default() {
        require_keys_eq!(
            ctx.accounts.provider_wallet.key(),
            job_ro.provider,
            MarketError::WrongRecipient
        );
        let (expected, _) =
            Pubkey::find_program_address(&[PROVIDER_SEED, job_ro.provider.as_ref()], &crate::ID);
        require_keys_eq!(
            ctx.accounts.provider_account.key(),
            expected,
            MarketError::WrongProviderAccount
        );
    } else {
        require_keys_eq!(
            ctx.accounts.provider_wallet.key(),
            job_ro.requester,
            MarketError::WrongRecipient
        );
    }

    // Transition
    {
        let job = &mut ctx.accounts.job;
        check_transition(job.status, to, now, job.deadline_unix)?;
        job.status = to;
    }

    // Persist the status change now: after commit_and_undelegate the ER forbids further
    // writes, and Anchor's automatic exit must then write identical bytes.
    ctx.accounts.job.exit(&crate::ID)?;

    // Scrub private bytes before anything can commit. The `RefMut` from
    // `load_mut()` is dropped at the end of this block so the permission CPIs
    // and the intent bundle can borrow `job_private`'s AccountInfo data.
    {
        let mut jp = ctx.accounts.job_private.load_mut()?;
        jp.scrub();
    }

    // Close ER-local permissions (skip if never created).
    let requester = ctx.accounts.job.requester;
    let nonce_bytes = ctx.accounts.job.nonce.to_le_bytes();
    let job_bump = [ctx.accounts.job.bump];
    let job_seeds: &[&[u8]] = &[JOB_SEED, requester.as_ref(), &nonce_bytes, &job_bump];
    let job_key = ctx.accounts.job.key();
    let jp_bump = [ctx.bumps.job_private];
    let jp_seeds: &[&[u8]] = &[JOB_PRIVATE_SEED, job_key.as_ref(), &jp_bump];

    if permission_exists(&ctx.accounts.job_permission) {
        CloseEphemeralPermissionCpi {
            payer: ctx.accounts.job.to_account_info(),
            permissioned_account: ctx.accounts.job.to_account_info(),
            permission: ctx.accounts.job_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.job.to_account_info(),
            authority_is_signer: false,
        }
        .invoke_signed(&[job_seeds])?;
    }
    if permission_exists(&ctx.accounts.job_private_permission) {
        CloseEphemeralPermissionCpi {
            payer: ctx.accounts.job_private.to_account_info(),
            permissioned_account: ctx.accounts.job_private.to_account_info(),
            permission: ctx.accounts.job_private_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            authority: ctx.accounts.job_private.to_account_info(),
            authority_is_signer: false,
        }
        .invoke_signed(&[jp_seeds])?;
    }

    // Commit-and-undelegate both PDAs, optionally with the settle action scheduled
    // to run after undelegation.
    let builder = MagicIntentBundleBuilder::new(
        ctx.accounts.signer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[
        ctx.accounts.job.to_account_info(),
        ctx.accounts.job_private.to_account_info(),
    ]);

    if schedule_action {
        let data = anchor_lang::InstructionData::data(&crate::instruction::SettleAction {});
        let action = CallHandler {
            destination_program: crate::ID,
            accounts: vec![
                ShortAccountMeta {
                    pubkey: ctx.accounts.job_escrow.key().to_bytes().into(),
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: ctx.accounts.job.key().to_bytes().into(),
                    is_writable: false,
                },
                ShortAccountMeta {
                    pubkey: ctx.accounts.provider_account.key().to_bytes().into(),
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: ctx.accounts.requester_wallet.key().to_bytes().into(),
                    is_writable: true,
                },
                ShortAccountMeta {
                    pubkey: ctx.accounts.provider_wallet.key().to_bytes().into(),
                    is_writable: true,
                },
            ],
            args: ActionArgs::new(data),
            escrow_authority: ctx.accounts.signer.to_account_info(),
            compute_units: 200_000,
        };
        // Post-undelegate, not post-commit: the committor places post-commit actions
        // before the undelegation instructions, so settle_action would still see `job`
        // owned by the delegation program and fail with JobStillDelegated. Running it
        // after undelegation gives it the program-owned `job` it deserializes.
        builder
            .add_post_undelegate_actions([action])
            .build_and_invoke()?;
    } else {
        builder.build_and_invoke()?;
    }
    Ok(())
}
