use anchor_lang::prelude::*;

use crate::errors::MarketError;
use crate::state::*;

#[derive(Accounts)]
pub struct CloseJob<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(
        mut,
        close = requester,
        seeds = [JOB_SEED, requester.key().as_ref(), &job.nonce.to_le_bytes()],
        bump = job.bump,
        has_one = requester,
        constraint = job.status.is_terminal() @ MarketError::NotTerminal
    )]
    pub job: Account<'info, Job>,
    #[account(mut, close = requester, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
    #[account(
        mut,
        close = requester,
        seeds = [ESCROW_SEED, job.key().as_ref()],
        bump = job_escrow.bump,
        constraint = job_escrow.paid @ MarketError::NotPaid
    )]
    pub job_escrow: Account<'info, Escrow>,
}

pub fn handler(_ctx: Context<CloseJob>) -> Result<()> {
    Ok(())
}
