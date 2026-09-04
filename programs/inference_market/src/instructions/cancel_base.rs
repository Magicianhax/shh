use anchor_lang::prelude::*;

use crate::errors::MarketError;
use crate::logic::check_transition;
use crate::state::*;

/// Base-layer cancel for a job that was created but never delegated.
/// `Account<Job>` enforces program ownership, so a delegated job cannot use this path.
#[derive(Accounts)]
pub struct CancelJobBase<'info> {
    pub requester: Signer<'info>,
    #[account(
        mut,
        seeds = [JOB_SEED, requester.key().as_ref(), &job.nonce.to_le_bytes()],
        bump = job.bump,
        has_one = requester @ MarketError::Unauthorized
    )]
    pub job: Account<'info, Job>,
}

pub fn handler(ctx: Context<CancelJobBase>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;
    require!(job.status == JobStatus::Created, MarketError::InvalidTransition);
    check_transition(job.status, JobStatus::Cancelled, now, job.deadline_unix)?;
    job.status = JobStatus::Cancelled;
    Ok(())
}
