use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use ephemeral_rollups_sdk::access_control::structs::EphemeralPermission;

use crate::errors::MarketError;
use crate::state::*;

#[event]
pub struct JobCreated {
    pub job: Pubkey,
    pub requester: Pubkey,
    pub price_lamports: u64,
    pub deadline_unix: i64,
    pub model_label: [u8; MODEL_LABEL_LEN],
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreateJob<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(
        init,
        payer = requester,
        space = 8 + Job::INIT_SPACE,
        seeds = [JOB_SEED, requester.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub job: Account<'info, Job>,
    #[account(
        init,
        payer = requester,
        space = JobPrivate::SPACE,
        seeds = [JOB_PRIVATE_SEED, job.key().as_ref()],
        bump
    )]
    pub job_private: AccountLoader<'info, JobPrivate>,
    #[account(
        init,
        payer = requester,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [ESCROW_SEED, job.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateJob>,
    nonce: u64,
    price_lamports: u64,
    deadline_unix: i64,
    model_label: [u8; MODEL_LABEL_LEN],
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(price_lamports > 0, MarketError::ZeroPrice);
    require!(deadline_unix >= now + MIN_DEADLINE_SECS, MarketError::DeadlineTooSoon);

    let job_key = ctx.accounts.job.key();
    {
        let job = &mut ctx.accounts.job;
        job.requester = ctx.accounts.requester.key();
        job.provider = Pubkey::default();
        job.nonce = nonce;
        job.status = JobStatus::Created;
        job.price_lamports = price_lamports;
        job.deadline_unix = deadline_unix;
        job.model_label = model_label;
        job.prompt_hash = [0u8; 32];
        job.output_hash = [0u8; 32];
        job.created_at = now;
        job.claimed_at = 0;
        job.submitted_at = 0;
        job.bump = ctx.bumps.job;
    }
    {
        let mut jp = ctx.accounts.job_private.load_init()?;
        jp.job = job_key;
        jp.prompt_len = 0;
        jp.output_len = 0;
        jp.bump = ctx.bumps.job_private;
    }
    {
        let escrow = &mut ctx.accounts.escrow;
        escrow.job = job_key;
        escrow.amount = price_lamports;
        escrow.paid = false;
        escrow.bump = ctx.bumps.escrow;
    }

    // Fund escrow with the price.
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.requester.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
        ),
        price_lamports,
    )?;

    // Pre-fund permission rent: the delegated PDAs pay for their ER-local permissions.
    let job_perm_rent =
        ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(0) as u32);
    let private_perm_rent = ephemeral_rollups_sdk::ephemeral_accounts::rent(
        EphemeralPermission::size_of(MAX_PERMISSION_MEMBERS) as u32,
    );
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.requester.to_account_info(),
                to: ctx.accounts.job.to_account_info(),
            },
        ),
        job_perm_rent,
    )?;
    transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            Transfer {
                from: ctx.accounts.requester.to_account_info(),
                to: ctx.accounts.job_private.to_account_info(),
            },
        ),
        private_perm_rent,
    )?;

    emit!(JobCreated {
        job: job_key,
        requester: ctx.accounts.requester.key(),
        price_lamports,
        deadline_unix,
        model_label,
    });
    Ok(())
}
