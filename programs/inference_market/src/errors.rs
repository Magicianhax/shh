use anchor_lang::prelude::*;

#[error_code]
pub enum MarketError {
    #[msg("Invalid status transition")]
    InvalidTransition,
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Deadline must be at least MIN_DEADLINE_SECS in the future")]
    DeadlineTooSoon,
    #[msg("Price must be greater than zero")]
    ZeroPrice,
    #[msg("Chunk exceeds CHUNK_MAX bytes")]
    ChunkTooLarge,
    #[msg("Chunk write out of bounds")]
    ChunkOutOfBounds,
    #[msg("Payload is empty")]
    EmptyPayload,
    #[msg("Finalize length exceeds bytes written")]
    LengthExceedsWritten,
    #[msg("Permission member count exceeds MAX_PERMISSION_MEMBERS")]
    TooManyMembers,
    #[msg("Escrow already settled")]
    AlreadySettled,
    #[msg("Job is still delegated; wait for undelegation")]
    JobStillDelegated,
    #[msg("Job is not in a terminal status")]
    NotTerminal,
    #[msg("Recipient account does not match job")]
    WrongRecipient,
    #[msg("Provider account does not match job.provider")]
    WrongProviderAccount,
    #[msg("Escrow does not belong to this job")]
    EscrowJobMismatch,
    #[msg("Escrow has not been paid out yet")]
    NotPaid,
}
