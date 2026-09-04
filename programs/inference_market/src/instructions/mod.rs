pub mod cancel_base;
pub mod claim;
pub mod close_job;
pub mod create_job;
pub mod delegate_job;
pub mod finish;
pub mod output;
pub mod permissions;
pub mod prompt;
pub mod register_provider;
pub mod settle;

pub use cancel_base::CancelJobBase;
pub use claim::ClaimJob;
pub use close_job::CloseJob;
pub use create_job::{CreateJob, JobCreated};
pub use delegate_job::{DelegateJob, DelegateJobPrivate};
pub use finish::FinishJob;
pub use output::OutputCtx;
pub use permissions::InitPermissions;
pub use prompt::PromptCtx;
pub use register_provider::RegisterProvider;
pub use settle::{SettleAction, SettleDirect};

// Anchor's #[derive(Accounts)] generates crate-visible `__client_accounts_*`
// modules that the `#[program]` macro's CPI/client codegen looks up through
// `instructions::*`. Re-export them explicitly (never a bare glob) so that
// codegen keeps working without reintroducing the `handler` name collision
// that a `pub use create_job::*; pub use register_provider::*;` glob causes.
pub(crate) use cancel_base::__client_accounts_cancel_job_base;
pub(crate) use claim::__client_accounts_claim_job;
pub(crate) use close_job::__client_accounts_close_job;
pub(crate) use create_job::__client_accounts_create_job;
pub(crate) use delegate_job::{__client_accounts_delegate_job, __client_accounts_delegate_job_private};
pub(crate) use finish::__client_accounts_finish_job;
pub(crate) use output::__client_accounts_output_ctx;
pub(crate) use permissions::__client_accounts_init_permissions;
pub(crate) use prompt::__client_accounts_prompt_ctx;
pub(crate) use register_provider::__client_accounts_register_provider;
pub(crate) use settle::{__client_accounts_settle_action, __client_accounts_settle_direct};
