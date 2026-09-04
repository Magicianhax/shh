use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member, PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};

use crate::state::*;

pub const MEMBER_FLAGS: u8 = TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG;

/// True only when `acc` is already an initialized Permission Program account.
/// Presence of lamports alone is not sufficient: a pre-funded-but-uninitialized
/// PDA (or one temporarily holding a balance for another reason) must still be
/// treated as "no permission exists yet" so creation is attempted.
pub(crate) fn permission_exists(acc: &UncheckedAccount) -> bool {
    acc.owner == &PERMISSION_PROGRAM_ID && !acc.data_is_empty()
}

#[derive(Accounts)]
pub struct InitPermissions<'info> {
    #[account(mut)]
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
    /// CHECK: permission PDA for `job`, derived under the Permission Program.
    #[account(mut, seeds = [PERMISSION_SEED, job.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub job_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA for `job_private`.
    #[account(mut, seeds = [PERMISSION_SEED, job_private.key().as_ref()], bump, seeds::program = PERMISSION_PROGRAM_ID)]
    pub job_private_permission: UncheckedAccount<'info>,
    /// CHECK: fixed program id.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: fixed vault.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: fixed program id.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<InitPermissions>) -> Result<()> {
    let requester = ctx.accounts.requester.key();
    let nonce_bytes = ctx.accounts.job.nonce.to_le_bytes();
    let job_bump = [ctx.accounts.job.bump];
    let job_seeds: &[&[u8]] = &[JOB_SEED, requester.as_ref(), &nonce_bytes, &job_bump];

    if !permission_exists(&ctx.accounts.job_permission) {
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.job.to_account_info(),
            permissioned_account: ctx.accounts.job.to_account_info(),
            permission: ctx.accounts.job_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private: false, members: vec![] },
        }
        .invoke_signed(&[job_seeds])?;
    }

    let job_key = ctx.accounts.job.key();
    let jp_bump = [ctx.bumps.job_private];
    let jp_seeds: &[&[u8]] = &[JOB_PRIVATE_SEED, job_key.as_ref(), &jp_bump];

    if !permission_exists(&ctx.accounts.job_private_permission) {
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.job_private.to_account_info(),
            permissioned_account: ctx.accounts.job_private.to_account_info(),
            permission: ctx.accounts.job_private_permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![Member { flags: MEMBER_FLAGS, pubkey: requester }],
            },
        }
        .invoke_signed(&[jp_seeds])?;
    }
    Ok(())
}
