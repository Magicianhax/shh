use anchor_lang::prelude::*;

pub const PROVIDER_SEED: &[u8] = b"provider";
pub const JOB_SEED: &[u8] = b"job";
pub const JOB_PRIVATE_SEED: &[u8] = b"job-private";
pub const ESCROW_SEED: &[u8] = b"escrow";

pub const PROMPT_MAX: usize = 4096;
pub const OUTPUT_MAX: usize = 5120;
pub const CHUNK_MAX: usize = 900;
pub const MODEL_LABEL_LEN: usize = 32;
pub const MAX_PERMISSION_MEMBERS: usize = 2;
pub const MIN_DEADLINE_SECS: i64 = 60;
pub const ACTION_ESCROW_INDEX: u8 = 255;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum JobStatus {
    Created,
    Open,
    Claimed,
    Submitted,
    Approved,
    Rejected,
    Cancelled,
    Expired,
}

impl JobStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            JobStatus::Approved | JobStatus::Rejected | JobStatus::Cancelled | JobStatus::Expired
        )
    }
}

#[account]
#[derive(InitSpace)]
pub struct Provider {
    pub authority: Pubkey,
    pub model_label: [u8; MODEL_LABEL_LEN],
    pub completed: u32,
    pub rejected: u32,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Job {
    pub requester: Pubkey,
    pub provider: Pubkey,
    pub nonce: u64,
    pub status: JobStatus,
    pub price_lamports: u64,
    pub deadline_unix: i64,
    pub model_label: [u8; MODEL_LABEL_LEN],
    pub prompt_hash: [u8; 32],
    pub output_hash: [u8; 32],
    pub created_at: i64,
    pub claimed_at: i64,
    pub submitted_at: i64,
    pub bump: u8,
}

/// Zero-copy: ~9 KB buffer written in chunks. Field order avoids interior padding.
#[account(zero_copy)]
#[repr(C)]
pub struct JobPrivate {
    pub job: Pubkey,
    pub prompt: [u8; PROMPT_MAX],
    pub output: [u8; OUTPUT_MAX],
    pub prompt_len: u16,
    pub output_len: u16,
    pub bump: u8,
    pub _pad: [u8; 1],
}

impl JobPrivate {
    pub const SPACE: usize = 8 + core::mem::size_of::<JobPrivate>();

    pub fn scrub(&mut self) {
        self.prompt = [0u8; PROMPT_MAX];
        self.output = [0u8; OUTPUT_MAX];
        self.prompt_len = 0;
        self.output_len = 0;
    }
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub job: Pubkey,
    pub amount: u64,
    pub paid: bool,
    pub bump: u8,
}
