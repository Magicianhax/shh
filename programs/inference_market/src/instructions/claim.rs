use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::UpdateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{EphemeralMembersArgs, Member, PERMISSION_SEED};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};

use crate::errors::MarketError;
use crate::instructions::permissions::MEMBER_FLAGS;
use crate::logic::check_transition;
use crate::state::*;

#[derive(Accounts)]
pub struct ClaimJob<'info> {
    #[account(mut)]
    pub provider: Signer<'info>,
    #[account(
        seeds = [PROVIDER_SEED, provider.key().as_ref()],
        bump = provider_account.bump,
        constraint = provider_account.authority == provider.key() @ MarketError::Unauthorized
    )]
    pub provider_account: Account<'info, Provider>,
    #[account(mut, seeds = [JOB_SEED, job.requester.as_ref(), &job.nonce.to_le_bytes()], bump = job.bump)]
    pub job: Account<'info, Job>,
    #[account(mut, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
    /// CHECK: permission PDA for job_private.
    #[account(mut, seeds = [PERMISSION_SEED, job_private.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub job_private_permission: UncheckedAccount<'info>,
    /// CHECK: fixed.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<ClaimJob>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;
    check_transition(job.status, JobStatus::Claimed, now, job.deadline_unix)?;
    require!(job.provider == Pubkey::default(), MarketError::InvalidTransition);
    job.provider = ctx.accounts.provider.key();
    job.claimed_at = now;
    job.status = JobStatus::Claimed;

    let members = vec![
        Member { flags: MEMBER_FLAGS, pubkey: job.requester },
        Member { flags: MEMBER_FLAGS, pubkey: job.provider },
    ];
    require!(members.len() <= MAX_PERMISSION_MEMBERS, MarketError::TooManyMembers);

    let job_key = job.key();
    let jp_bump = [ctx.bumps.job_private];
    let jp_seeds: &[&[u8]] = &[JOB_PRIVATE_SEED, job_key.as_ref(), &jp_bump];
    UpdateEphemeralPermissionCpi {
        payer: ctx.accounts.job_private.to_account_info(),
        permissioned_account: ctx.accounts.job_private.to_account_info(),
        permission: ctx.accounts.job_private_permission.to_account_info(),
        vault: ctx.accounts.ephemeral_vault.to_account_info(),
        magic_program: ctx.accounts.magic_program.to_account_info(),
        permission_program: ctx.accounts.permission_program.to_account_info(),
        authority: ctx.accounts.job_private.to_account_info(),
        authority_is_signer: false,
        args: EphemeralMembersArgs { is_private: true, members },
    }
    .invoke_signed(&[jp_seeds])?;
    Ok(())
}
