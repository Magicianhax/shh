use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::state::{JOB_PRIVATE_SEED, JOB_SEED};

#[delegate]
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct DelegateJob<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    /// CHECK: delegated PDA; seeds bind it to the signer.
    #[account(mut, del, seeds = [JOB_SEED, requester.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub job: AccountInfo<'info>,
    /// CHECK: optional TEE validator identity forwarded in DelegateConfig.
    pub validator: Option<UncheckedAccount<'info>>,
}

pub fn delegate_job(ctx: Context<DelegateJob>, nonce: u64) -> Result<()> {
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
    ctx.accounts.delegate_job(
        &ctx.accounts.requester,
        &[JOB_SEED, ctx.accounts.requester.key().as_ref(), &nonce.to_le_bytes()],
        DelegateConfig { validator, ..Default::default() },
    )?;
    Ok(())
}

#[delegate]
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct DelegateJobPrivate<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    /// CHECK: only used to derive job_private's seed; ownership may already be the delegation program.
    #[account(seeds = [JOB_SEED, requester.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub job: UncheckedAccount<'info>,
    /// CHECK: delegated PDA.
    #[account(mut, del, seeds = [JOB_PRIVATE_SEED, job.key().as_ref()], bump)]
    pub job_private: AccountInfo<'info>,
    /// CHECK: optional TEE validator identity.
    pub validator: Option<UncheckedAccount<'info>>,
}

pub fn delegate_job_private(ctx: Context<DelegateJobPrivate>, _nonce: u64) -> Result<()> {
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
    let job_key = ctx.accounts.job.key();
    ctx.accounts.delegate_job_private(
        &ctx.accounts.requester,
        &[JOB_PRIVATE_SEED, job_key.as_ref()],
        DelegateConfig { validator, ..Default::default() },
    )?;
    Ok(())
}
