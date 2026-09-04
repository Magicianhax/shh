use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod errors;
pub mod instructions;
pub mod logic;
pub mod state;

declare_id!("HWeUskL1BSdZid4xsbSMBeZ4YH4FsTiYpdXDFZKzyBoe");

#[ephemeral]
#[program]
pub mod inference_market {
    use super::*;
}
