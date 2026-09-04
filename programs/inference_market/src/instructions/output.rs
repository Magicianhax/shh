use anchor_lang::prelude::*;

use crate::errors::MarketError;
use crate::logic::{check_transition, hash_bytes, write_chunk};
use crate::state::*;

#[derive(Accounts)]
pub struct OutputCtx<'info> {
    pub provider: Signer<'info>,
    #[account(
        mut,
        seeds = [JOB_SEED, job.requester.as_ref(), &job.nonce.to_le_bytes()],
        bump = job.bump,
        constraint = job.provider == provider.key() @ MarketError::Unauthorized
    )]
    pub job: Account<'info, Job>,
    #[account(mut, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
}

pub fn write_output(ctx: Context<OutputCtx>, offset: u16, data: Vec<u8>) -> Result<()> {
    require!(ctx.accounts.job.status == JobStatus::Claimed, MarketError::InvalidTransition);
    let mut jp = ctx.accounts.job_private.load_mut()?;
    let cur = jp.output_len;
    jp.output_len = write_chunk(&mut jp.output, cur, offset, &data)?;
    Ok(())
}

pub fn finalize_output(ctx: Context<OutputCtx>, len: u16) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;
    check_transition(job.status, JobStatus::Submitted, now, job.deadline_unix)?;
    require!(len > 0, MarketError::EmptyPayload);
    let mut jp = ctx.accounts.job_private.load_mut()?;
    require!(len <= jp.output_len, MarketError::LengthExceedsWritten);
    jp.output_len = len;
    job.output_hash = hash_bytes(&jp.output[..len as usize]);
    job.submitted_at = now;
    job.status = JobStatus::Submitted;
    Ok(())
}
