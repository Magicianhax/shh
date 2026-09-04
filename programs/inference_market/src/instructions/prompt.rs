use anchor_lang::prelude::*;

use crate::errors::MarketError;
use crate::logic::{check_transition, hash_bytes, write_chunk};
use crate::state::*;

#[derive(Accounts)]
pub struct PromptCtx<'info> {
    pub requester: Signer<'info>,
    #[account(
        mut,
        seeds = [JOB_SEED, requester.key().as_ref(), &job.nonce.to_le_bytes()],
        bump = job.bump,
        has_one = requester
    )]
    pub job: Account<'info, Job>,
    #[account(mut, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountLoader<'info, JobPrivate>,
}

pub fn write_prompt(ctx: Context<PromptCtx>, offset: u16, data: Vec<u8>) -> Result<()> {
    require!(ctx.accounts.job.status == JobStatus::Created, MarketError::InvalidTransition);
    let mut jp = ctx.accounts.job_private.load_mut()?;
    let cur = jp.prompt_len;
    jp.prompt_len = write_chunk(&mut jp.prompt, cur, offset, &data)?;
    Ok(())
}

pub fn finalize_prompt(ctx: Context<PromptCtx>, len: u16) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let job = &mut ctx.accounts.job;
    check_transition(job.status, JobStatus::Open, now, job.deadline_unix)?;
    require!(len > 0, MarketError::EmptyPayload);
    let mut jp = ctx.accounts.job_private.load_mut()?;
    require!(len <= jp.prompt_len, MarketError::LengthExceedsWritten);
    jp.prompt_len = len;
    job.prompt_hash = hash_bytes(&jp.prompt[..len as usize]);
    job.status = JobStatus::Open;
    Ok(())
}
