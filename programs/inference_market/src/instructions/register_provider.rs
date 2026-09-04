use anchor_lang::prelude::*;

use crate::state::{Provider, MODEL_LABEL_LEN, PROVIDER_SEED};

#[derive(Accounts)]
pub struct RegisterProvider<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Provider::INIT_SPACE,
        seeds = [PROVIDER_SEED, authority.key().as_ref()],
        bump
    )]
    pub provider_account: Account<'info, Provider>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterProvider>, model_label: [u8; MODEL_LABEL_LEN]) -> Result<()> {
    let p = &mut ctx.accounts.provider_account;
    p.authority = ctx.accounts.authority.key();
    p.model_label = model_label;
    p.completed = 0;
    p.rejected = 0;
    p.bump = ctx.bumps.provider_account;
    Ok(())
}
