use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod errors;
pub mod instructions;
pub mod logic;
pub mod state;

use instructions::*;

declare_id!("HWeUskL1BSdZid4xsbSMBeZ4YH4FsTiYpdXDFZKzyBoe");

#[ephemeral]
#[program]
pub mod inference_market {
    use super::*;

    pub fn register_provider(
        ctx: Context<RegisterProvider>,
        model_label: [u8; state::MODEL_LABEL_LEN],
    ) -> Result<()> {
        instructions::register_provider::handler(ctx, model_label)
    }

    pub fn create_job(
        ctx: Context<CreateJob>,
        nonce: u64,
        price_lamports: u64,
        deadline_unix: i64,
        model_label: [u8; state::MODEL_LABEL_LEN],
    ) -> Result<()> {
        instructions::create_job::handler(ctx, nonce, price_lamports, deadline_unix, model_label)
    }

    pub fn delegate_job(ctx: Context<DelegateJob>, nonce: u64) -> Result<()> {
        instructions::delegate_job::delegate_job(ctx, nonce)
    }
    pub fn delegate_job_private(ctx: Context<DelegateJobPrivate>, nonce: u64) -> Result<()> {
        instructions::delegate_job::delegate_job_private(ctx, nonce)
    }

    pub fn init_permissions(ctx: Context<InitPermissions>) -> Result<()> {
        instructions::permissions::handler(ctx)
    }
    pub fn write_prompt(ctx: Context<PromptCtx>, offset: u16, data: Vec<u8>) -> Result<()> {
        instructions::prompt::write_prompt(ctx, offset, data)
    }
    pub fn finalize_prompt(ctx: Context<PromptCtx>, len: u16) -> Result<()> {
        instructions::prompt::finalize_prompt(ctx, len)
    }
    pub fn claim_job(ctx: Context<ClaimJob>) -> Result<()> {
        instructions::claim::handler(ctx)
    }
    pub fn write_output(ctx: Context<OutputCtx>, offset: u16, data: Vec<u8>) -> Result<()> {
        instructions::output::write_output(ctx, offset, data)
    }
    pub fn finalize_output(ctx: Context<OutputCtx>, len: u16) -> Result<()> {
        instructions::output::finalize_output(ctx, len)
    }

    pub fn approve_job(ctx: Context<FinishJob>, schedule_action: bool) -> Result<()> {
        instructions::finish::run(ctx, state::JobStatus::Approved, schedule_action)
    }
    pub fn reject_job(ctx: Context<FinishJob>, schedule_action: bool) -> Result<()> {
        instructions::finish::run(ctx, state::JobStatus::Rejected, schedule_action)
    }
    pub fn cancel_job(ctx: Context<FinishJob>, schedule_action: bool) -> Result<()> {
        instructions::finish::run(ctx, state::JobStatus::Cancelled, schedule_action)
    }
    pub fn expire_job(ctx: Context<FinishJob>, schedule_action: bool) -> Result<()> {
        instructions::finish::run(ctx, state::JobStatus::Expired, schedule_action)
    }

    pub fn settle_action(ctx: Context<SettleAction>) -> Result<()> {
        instructions::settle::settle_action(ctx)
    }
    pub fn settle_direct(ctx: Context<SettleDirect>) -> Result<()> {
        instructions::settle::settle_direct(ctx)
    }

    pub fn cancel_job_base(ctx: Context<CancelJobBase>) -> Result<()> {
        instructions::cancel_base::handler(ctx)
    }

    pub fn close_job(ctx: Context<CloseJob>) -> Result<()> {
        instructions::close_job::handler(ctx)
    }
}
