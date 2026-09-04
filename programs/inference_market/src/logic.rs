use anchor_lang::prelude::*;

use crate::errors::MarketError;
use crate::state::{JobStatus, CHUNK_MAX};

pub enum Recipient {
    Provider,
    Requester,
}

pub fn check_transition(from: JobStatus, to: JobStatus, now: i64, deadline: i64) -> Result<()> {
    use JobStatus::*;
    let ok = match (from, to) {
        (Created, Open) => true,
        (Open, Claimed) => now < deadline,
        (Claimed, Submitted) => now < deadline,
        (Submitted, Approved) | (Submitted, Rejected) => true,
        (Created, Cancelled) | (Open, Cancelled) => true,
        (Open, Expired) | (Claimed, Expired) => now >= deadline,
        _ => false,
    };
    require!(ok, MarketError::InvalidTransition);
    Ok(())
}

pub fn settle_recipient(status: JobStatus) -> Result<Recipient> {
    use JobStatus::*;
    match status {
        Approved => Ok(Recipient::Provider),
        Rejected | Cancelled | Expired => Ok(Recipient::Requester),
        _ => err!(MarketError::NotTerminal),
    }
}

pub fn write_chunk(buf: &mut [u8], cur_len: u16, offset: u16, data: &[u8]) -> Result<u16> {
    require!(!data.is_empty(), MarketError::EmptyPayload);
    require!(data.len() <= CHUNK_MAX, MarketError::ChunkTooLarge);
    let start = offset as usize;
    let end = start
        .checked_add(data.len())
        .ok_or(MarketError::ChunkOutOfBounds)?;
    require!(end <= buf.len(), MarketError::ChunkOutOfBounds);
    buf[start..end].copy_from_slice(data);
    Ok(core::cmp::max(cur_len as usize, end) as u16)
}

pub fn hash_bytes(bytes: &[u8]) -> [u8; 32] {
    solana_sha256_hasher::hash(bytes).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use JobStatus::*;

    #[test]
    fn happy_path_transitions() {
        assert!(check_transition(Created, Open, 100, 1000).is_ok());
        assert!(check_transition(Open, Claimed, 100, 1000).is_ok());
        assert!(check_transition(Claimed, Submitted, 100, 1000).is_ok());
        assert!(check_transition(Submitted, Approved, 100, 1000).is_ok());
        assert!(check_transition(Submitted, Rejected, 100, 1000).is_ok());
    }

    #[test]
    fn cancel_only_before_claim() {
        assert!(check_transition(Created, Cancelled, 100, 1000).is_ok());
        assert!(check_transition(Open, Cancelled, 100, 1000).is_ok());
        assert!(check_transition(Claimed, Cancelled, 100, 1000).is_err());
        assert!(check_transition(Submitted, Cancelled, 100, 1000).is_err());
    }

    #[test]
    fn expire_only_after_deadline_and_before_submission() {
        assert!(check_transition(Open, Expired, 1000, 1000).is_ok());
        assert!(check_transition(Claimed, Expired, 1001, 1000).is_ok());
        assert!(check_transition(Claimed, Expired, 999, 1000).is_err());
        assert!(check_transition(Submitted, Expired, 5000, 1000).is_err());
    }

    #[test]
    fn claim_and_submit_rejected_after_deadline() {
        assert!(check_transition(Open, Claimed, 1000, 1000).is_err());
        assert!(check_transition(Claimed, Submitted, 1000, 1000).is_err());
    }

    #[test]
    fn terminal_states_are_sinks() {
        for s in [Approved, Rejected, Cancelled, Expired] {
            for t in [Created, Open, Claimed, Submitted, Approved, Rejected, Cancelled, Expired] {
                assert!(check_transition(s, t, 0, 1000).is_err());
            }
        }
    }

    #[test]
    fn recipient_by_status() {
        assert!(matches!(settle_recipient(Approved).unwrap(), Recipient::Provider));
        assert!(matches!(settle_recipient(Rejected).unwrap(), Recipient::Requester));
        assert!(matches!(settle_recipient(Cancelled).unwrap(), Recipient::Requester));
        assert!(matches!(settle_recipient(Expired).unwrap(), Recipient::Requester));
        assert!(settle_recipient(Submitted).is_err());
    }

    #[test]
    fn write_chunk_appends_and_tracks_len() {
        let mut buf = [0u8; 32];
        let len = write_chunk(&mut buf, 0, 0, b"hello").unwrap();
        assert_eq!(len, 5);
        let len = write_chunk(&mut buf, len, 5, b" world").unwrap();
        assert_eq!(len, 11);
        assert_eq!(&buf[..11], b"hello world");
        // overwrite in the middle keeps the larger length
        let len = write_chunk(&mut buf, len, 0, b"J").unwrap();
        assert_eq!(len, 11);
        assert_eq!(&buf[..11], b"Jello world");
    }

    #[test]
    fn write_chunk_rejects_bad_input() {
        let mut buf = [0u8; 32];
        assert!(write_chunk(&mut buf, 0, 30, b"abc").is_err()); // out of bounds
        assert!(write_chunk(&mut buf, 0, 0, b"").is_err()); // empty
        let big = vec![1u8; CHUNK_MAX + 1];
        let mut big_buf = vec![0u8; CHUNK_MAX + 10];
        assert!(write_chunk(&mut big_buf, 0, 0, &big).is_err()); // too large
    }

    #[test]
    fn hash_is_sha256() {
        let h = hash_bytes(b"abc");
        assert_eq!(
            h[..4],
            [0xba, 0x78, 0x16, 0xbf]
        );
    }
}
