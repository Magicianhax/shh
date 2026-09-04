use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::action;

use crate::errors::MarketError;
use crate::logic::{settle_recipient, Recipient};
use crate::state::*;

// `escrow` is the gate here: only the delegation program can sign for the
// ephemeral balance PDA, which is what proves this came from the scheduled
// post-undelegate action. `escrow_auth` is deliberately unbounded — any funded
// payer may have scheduled it — because settlement itself is permissionless:
// `settle_direct` runs the identical `settle` validation for anyone who asks.
#[action]
#[derive(Accounts)]
pub struct SettleAction<'info> {
    #[account(mut, seeds = [ESCROW_SEED, job.key().as_ref()], bump = job_escrow.bump)]
    pub job_escrow: Account<'info, Escrow>,
    /// CHECK: deserialized manually; must be owned by this program (undelegated).
    pub job: UncheckedAccount<'info>,
    /// CHECK: validated against job.provider in handler.
    #[account(mut)]
    pub provider_account: UncheckedAccount<'info>,
    /// CHECK: validated == job.requester.
    #[account(mut)]
    pub requester_wallet: UncheckedAccount<'info>,
    /// CHECK: validated == job.provider when paying provider.
    #[account(mut)]
    pub provider_wallet: UncheckedAccount<'info>,
    /// CHECK: program that scheduled the action; the delegation program appends it before escrow_auth/escrow.
    #[account(address = crate::ID @ MarketError::Unauthorized)]
    pub source_program: UncheckedAccount<'info>,
    /// CHECK: payer identity the action was scheduled with.
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: only the delegation program can sign for this PDA; proves the post-commit path.
    #[account(
        signer @ MarketError::Unauthorized,
        address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(&escrow_auth.key(), ACTION_ESCROW_INDEX) @ MarketError::Unauthorized,
    )]
    pub escrow: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct SettleDirect<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ESCROW_SEED, job.key().as_ref()], bump = job_escrow.bump)]
    pub job_escrow: Account<'info, Escrow>,
    /// CHECK: deserialized manually; must be owned by this program (undelegated).
    pub job: UncheckedAccount<'info>,
    /// CHECK: validated against job.provider in handler.
    #[account(mut)]
    pub provider_account: UncheckedAccount<'info>,
    /// CHECK: validated == job.requester.
    #[account(mut)]
    pub requester_wallet: UncheckedAccount<'info>,
    /// CHECK: validated == job.provider when paying provider.
    #[account(mut)]
    pub provider_wallet: UncheckedAccount<'info>,
}

pub fn settle_action(ctx: Context<SettleAction>) -> Result<()> {
    settle(
        &mut ctx.accounts.job_escrow,
        &ctx.accounts.job.to_account_info(),
        &ctx.accounts.provider_account.to_account_info(),
        &ctx.accounts.requester_wallet.to_account_info(),
        &ctx.accounts.provider_wallet.to_account_info(),
    )
}

pub fn settle_direct(ctx: Context<SettleDirect>) -> Result<()> {
    settle(
        &mut ctx.accounts.job_escrow,
        &ctx.accounts.job.to_account_info(),
        &ctx.accounts.provider_account.to_account_info(),
        &ctx.accounts.requester_wallet.to_account_info(),
        &ctx.accounts.provider_wallet.to_account_info(),
    )
}

fn settle<'info>(
    job_escrow: &mut Account<'info, Escrow>,
    job: &AccountInfo<'info>,
    provider_account: &AccountInfo<'info>,
    requester_wallet: &AccountInfo<'info>,
    provider_wallet: &AccountInfo<'info>,
) -> Result<()> {
    require_keys_eq!(*job.owner, crate::ID, MarketError::JobStillDelegated);
    let job_data = {
        let data = job.try_borrow_data()?;
        Job::try_deserialize(&mut &data[..])?
    };
    require_keys_eq!(job_escrow.job, job.key(), MarketError::EscrowJobMismatch);
    require!(!job_escrow.paid, MarketError::AlreadySettled);
    require!(job_data.status.is_terminal(), MarketError::NotTerminal);
    require_keys_eq!(
        requester_wallet.key(),
        job_data.requester,
        MarketError::WrongRecipient
    );

    let recipient = match settle_recipient(job_data.status)? {
        Recipient::Provider => {
            require_keys_eq!(
                provider_wallet.key(),
                job_data.provider,
                MarketError::WrongRecipient
            );
            provider_wallet
        }
        Recipient::Requester => requester_wallet,
    };

    if matches!(job_data.status, JobStatus::Approved | JobStatus::Rejected) {
        let (expected, _) =
            Pubkey::find_program_address(&[PROVIDER_SEED, job_data.provider.as_ref()], &crate::ID);
        require_keys_eq!(
            provider_account.key(),
            expected,
            MarketError::WrongProviderAccount
        );
        require_keys_eq!(
            *provider_account.owner,
            crate::ID,
            MarketError::WrongProviderAccount
        );
        let mut p = {
            let data = provider_account.try_borrow_data()?;
            Provider::try_deserialize(&mut &data[..])?
        };
        match job_data.status {
            JobStatus::Approved => p.completed = p.completed.saturating_add(1),
            JobStatus::Rejected => p.rejected = p.rejected.saturating_add(1),
            _ => {}
        }
        let mut data = provider_account.try_borrow_mut_data()?;
        p.try_serialize(&mut &mut data[..])?;
    }

    let amount = job_escrow.amount;
    **job_escrow.to_account_info().try_borrow_mut_lamports()? -= amount;
    **recipient.try_borrow_mut_lamports()? += amount;
    job_escrow.paid = true;
    Ok(())
}
