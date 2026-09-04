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
}
