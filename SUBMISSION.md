# Proof of Work — submission answers

Copy each block into the matching field. Only **Pitch & Demo** is blank; everything
else is filled and verified live.

---

## Project name

```
Shh
```

---

## Description

> What does your project do, and how does it make use of MagicBlock?

```
Shh is a marketplace for private AI inference, settled on Solana.

Ask a question and it becomes a paid job. The prompt is sealed inside a
MagicBlock TEE-backed Ephemeral Rollup, a provider claims it and answers it in
there, and you release the escrow when you approve the answer. Solana records
the job, both parties, a SHA-256 of the prompt, a SHA-256 of the output, and the
payment. It never records a word of either side.

How it uses MagicBlock, concretely:

- Delegation. create_job writes the Job and JobPrivate accounts on devnet, then
  delegates both to a TEE validator in the same transaction. Everything after
  that (writing the prompt in chunks, claiming, answering, sealing) happens in
  the rollup, so no prompt or output byte ever hits the base layer.
- Private Ephemeral Rollup. Reads are gated by ER-local EphemeralPermission
  accounts. The requester and the claiming provider can read the job; nobody
  else can, including the operator.
- Magic Actions. Approving schedules settle_action post-undelegate, so the
  escrow pays the provider inside the very same transaction that commits the
  rollup state back to Solana. One signature, and payment and settlement land
  together rather than needing a follow-up transaction.
- Magic Router. The client waits on getDelegationStatus to confirm both PDAs
  landed on the same validator before writing anything private.

Measured on devnet: about 15 seconds from send to answer, and the scheduled
payout settling 197 ms after undelegation with no fallback transaction.

Multi-model and multi-provider. Providers run an open-source worker against an
Anthropic, OpenAI, or Ollama backend, set a price floor per model, and are paid
on approval. 7 providers are registered on devnet.
```

---

## Categories (pick up to 3)

```
AI / Agents
Privacy
Infra
```

---

## Project website

```
https://shh.magician.wtf/
```

---

## GitHub Project Repo

```
https://github.com/Magicianhax/shh
```

---

## Pitch & Demo

```
<paste the recording link here — the only field still open>
```

---

## Explorer link (integration proof)

Use this one. It is the commit back to Solana: two `ProcessUndelegation`
instructions plus the scheduled `SettleAction` that pays the provider, all in a
single transaction, with the MagicBlock delegation program as a signer.

```
https://explorer.solana.com/tx/2dMuBPKPnGYnegUPznkXpqRWuHAWLfBDurCVxadYg52Fi2ms1Lmzk3NRHiuXs1jNniyT8tH1CJP7SLPVpSX5EM32?cluster=devnet
```

If a second link is allowed, this is the other half of the round trip:
`CreateJob` plus both delegate instructions, moving the job into the rollup.

```
https://explorer.solana.com/tx/4KC7KQ7UCEZJ9X3sMaMWHnKppTARXwnF1Nht6EMZdqFR6no15t8hw8A5uZqNeACHoAXVdoWASJTEDMuBfc7P1HXc?cluster=devnet
```

---

## Program addresses

```
HWeUskL1BSdZid4xsbSMBeZ4YH4FsTiYpdXDFZKzyBoe
```

Program on the explorer, if they want the address rather than a transaction:

```
https://explorer.solana.com/address/HWeUskL1BSdZid4xsbSMBeZ4YH4FsTiYpdXDFZKzyBoe?cluster=devnet
```

---

## If a judge clicks through

- It is **Solana devnet**. Say so; it is on the site and on the social card.
- Tell them to use **Backpack**. Phantom and Solflare simulate before showing
  their prompt, which on devnet took up to 100 seconds in testing, long enough
  for the blockhash to expire.
- A provider worker is running on Fly, so a job opened from the public site gets
  answered without anything local.
- Honest gap, worth stating before they find it: nothing yet stops a requester
  reading a good answer and rejecting anyway. The only consequence is the
  provider's public rejected count. No arbitration, no staking.

---

## Additional information (optional)

Paste this whole block. It carries the second base-layer link the form had no
field for, plus the rollup side.

```
Two more links that complete the picture.

1. The other half of the round trip on Solana devnet. CreateJob plus both
   delegate instructions, moving the job and its private account into the
   MagicBlock rollup:

   https://explorer.solana.com/tx/4KC7KQ7UCEZJ9X3sMaMWHnKppTARXwnF1Nht6EMZdqFR6no15t8hw8A5uZqNeACHoAXVdoWASJTEDMuBfc7P1HXc?cluster=devnet

2. The rollup itself. Solana Explorer pointed at the TEE Ephemeral Rollup RPC,
   showing an ApproveJob transaction that never touched the base layer:

   https://explorer.solana.com/tx/25MBauBagm9eBRtMhe6ryq8bpsX8jBwPsNExwmTK6jXTJZZvb2QF8fCi9FbZctc6fW6LdevUwhVfZF8S4PPp74gn?cluster=custom&customUrl=https%3A%2F%2Fdevnet-tee-as.magicblock.app

   Same explorer, cluster set to custom and the RPC set to
   https://devnet-tee-as.magicblock.app

That second link is worth opening, because it demonstrates the privacy claim
rather than asserting it. The rollup RPC answers getHealth, getSlot and
getSignaturesForAddress to anyone, so the transaction is right there and
verifiable. The prompt and the output are not: reading those account bytes
requires an auth token issued to a signed challenge from either the requester
or the provider who claimed the job. Public activity, private contents, which
is the whole design.

Measured on devnet, end to end: about 15 seconds from send to answer, and the
scheduled Magic Action settling the escrow 197 ms after undelegation with no
fallback transaction needed.

Worth knowing if you click through: use Backpack. Phantom and Solflare simulate
a transaction before rendering their approval prompt, which on devnet took up
to 100 seconds in our testing, long enough for the blockhash to expire. The app
detects that case, says so plainly, and offers a one-click resend.

One honest limitation, stated before you find it: nothing yet stops a requester
reading a good answer and rejecting it anyway. The only consequence is the
provider's public rejected count. No arbitration and no staking in this
version; that is the next piece of work.
```

---

## Team members (Telegram handles)

```
@<your Telegram handle>
```

Solo build unless you are adding someone. They get view and edit access, so only
add handles you want editing the submission.
