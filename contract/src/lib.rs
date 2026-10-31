//! AgentGuard vault.
//!
//! Roles:
//!  - agent    : an AI agent's sub-account. Its only key is a function-call key limited to
//!               `request_payment`. It can ASK to pay, never pay by itself.
//!  - guardian : the off-chain Guard service. Approves or rejects requests after the
//!               policy check and the scam check.
//!  - owner    : the human. Sets hard caps, rotates the guardian, withdraws funds.
//!
//! Even if the guardian is compromised or the policy is "no limits", the hard caps below
//! are enforced on-chain, so the damage is bounded.
use near_sdk::json_types::U128;
use near_sdk::store::Vector;
use near_sdk::{env, log, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const NS_PER_DAY: u64 = 86_400_000_000_000;
const MAX_PENDING: u64 = 100;
const MAX_MEMO: usize = 200;

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Pending,
    Paid,
    Rejected,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Payment {
    pub id: u64,
    pub to: AccountId,
    pub amount: U128,
    pub memo: String,
    pub status: Status,
    pub requested_at: u64,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub guardian: AccountId,
    pub agent: AccountId,
    pub hard_per_tx: U128,
    pub hard_daily: U128,
    pub spent_today: U128,
    pub day: u64,
    pub pending_count: u64,
    pub total_requests: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Vault {
    owner: AccountId,
    guardian: AccountId,
    agent: AccountId,
    hard_per_tx: u128,
    hard_daily: u128,
    day: u64,
    spent_today: u128,
    pending_count: u64,
    requests: Vector<Payment>,
}

fn today() -> u64 {
    env::block_timestamp() / NS_PER_DAY
}

#[near]
impl Vault {
    #[init]
    pub fn new(
        owner: AccountId,
        guardian: AccountId,
        agent: AccountId,
        hard_per_tx: U128,
        hard_daily: U128,
    ) -> Self {
        require!(
            hard_per_tx.0 > 0 && hard_daily.0 >= hard_per_tx.0,
            "hard caps must satisfy 0 < per_tx <= daily"
        );
        Self {
            owner,
            guardian,
            agent,
            hard_per_tx: hard_per_tx.0,
            hard_daily: hard_daily.0,
            day: today(),
            spent_today: 0,
            pending_count: 0,
            requests: Vector::new(b"r".to_vec()),
        }
    }

    // ---------- agent ----------

    /// The agent asks to pay `amount` yoctoNEAR to `to`. Nothing moves yet.
    pub fn request_payment(&mut self, to: AccountId, amount: U128, memo: String) -> u64 {
        require!(
            env::predecessor_account_id() == self.agent,
            "only the agent can request payments"
        );
        let amt = amount.0;
        require!(amt > 0, "amount must be positive");
        require!(
            amt <= self.hard_per_tx,
            "amount exceeds the on-chain per-transaction cap"
        );
        require!(memo.len() <= MAX_MEMO, "memo too long");
        require!(self.pending_count < MAX_PENDING, "too many pending requests");
        let id = self.requests.len() as u64;
        log!("EVENT payment_requested id={} to={} amount={}", id, to, amt);
        self.requests.push(Payment {
            id,
            to,
            amount,
            memo,
            status: Status::Pending,
            requested_at: env::block_timestamp(),
        });
        self.pending_count += 1;
        id
    }

    // ---------- guardian ----------

    /// Guardian approves a pending request; the vault pays out.
    pub fn approve(&mut self, id: u64) -> Promise {
        require!(
            env::predecessor_account_id() == self.guardian,
            "only the guardian can approve"
        );
        self.roll_day();
        require!(id < self.requests.len() as u64, "unknown request id");
        let idx = id as u32;
        let payment = self
            .requests
            .get(idx)
            .unwrap_or_else(|| env::panic_str("unknown request id"))
            .clone();
        require!(payment.status == Status::Pending, "request is not pending");
        let amt = payment.amount.0;
        require!(
            self.spent_today + amt <= self.hard_daily,
            "would exceed the on-chain daily cap"
        );
        require!(amt <= self.available_balance(), "insufficient vault balance");
        self.spent_today += amt;
        self.pending_count -= 1;
        self.requests.get_mut(idx).unwrap().status = Status::Paid;
        log!("EVENT payment_approved id={} to={} amount={}", id, payment.to, amt);
        Promise::new(payment.to).transfer(NearToken::from_yoctonear(amt))
    }

    /// Guardian or owner rejects a pending request.
    pub fn reject(&mut self, id: u64) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.guardian || caller == self.owner,
            "only the guardian or owner can reject"
        );
        require!(id < self.requests.len() as u64, "unknown request id");
        let idx = id as u32;
        let p = self.requests.get_mut(idx).unwrap();
        require!(p.status == Status::Pending, "request is not pending");
        p.status = Status::Rejected;
        self.pending_count -= 1;
        log!("EVENT payment_rejected id={}", id);
    }

    // ---------- owner ----------

    pub fn set_hard_caps(&mut self, per_tx: U128, daily: U128) {
        self.assert_owner();
        require!(per_tx.0 > 0 && daily.0 >= per_tx.0, "caps must satisfy 0 < per_tx <= daily");
        self.hard_per_tx = per_tx.0;
        self.hard_daily = daily.0;
    }

    pub fn set_guardian(&mut self, guardian: AccountId) {
        self.assert_owner();
        self.guardian = guardian;
    }

    pub fn withdraw(&mut self, amount: U128) -> Promise {
        self.assert_owner();
        require!(amount.0 <= self.available_balance(), "insufficient vault balance");
        Promise::new(self.owner.clone()).transfer(NearToken::from_yoctonear(amount.0))
    }

    // ---------- views ----------

    pub fn get_request(&self, id: u64) -> Option<Payment> {
        if id >= self.requests.len() as u64 {
            return None;
        }
        self.requests.get(id as u32).cloned()
    }

    /// Up to 50 requests starting at `from_index`.
    pub fn get_requests(&self, from_index: u64, limit: u64) -> Vec<Payment> {
        let end = from_index
            .saturating_add(limit.min(50))
            .min(self.requests.len() as u64);
        (from_index..end)
            .filter_map(|i| self.requests.get(i as u32).cloned())
            .collect()
    }

    pub fn get_config(&self) -> Config {
        let d = today();
        let spent = if d == self.day { self.spent_today } else { 0 };
        Config {
            owner: self.owner.clone(),
            guardian: self.guardian.clone(),
            agent: self.agent.clone(),
            hard_per_tx: U128(self.hard_per_tx),
            hard_daily: U128(self.hard_daily),
            spent_today: U128(spent),
            day: d,
            pending_count: self.pending_count,
            total_requests: self.requests.len() as u64,
        }
    }

    // ---------- internal ----------

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }

    fn roll_day(&mut self) {
        let d = today();
        if d != self.day {
            self.day = d;
            self.spent_today = 0;
        }
    }

    fn available_balance(&self) -> u128 {
        let storage = env::storage_byte_cost().as_yoctonear() * env::storage_usage() as u128;
        env::account_balance().as_yoctonear().saturating_sub(storage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const N: u128 = 1_000_000_000_000_000_000_000_000;

    fn as_account(who: AccountId) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(who)
            .account_balance(NearToken::from_near(100))
            .build());
    }

    // alice = owner, bob = guardian, charlie = agent, danny = destination
    fn vault() -> Vault {
        as_account(accounts(0));
        Vault::new(accounts(0), accounts(1), accounts(2), U128(5 * N), U128(20 * N))
    }

    #[test]
    fn agent_can_request_within_cap() {
        let mut v = vault();
        as_account(accounts(2));
        let id = v.request_payment(accounts(3), U128(N), "coffee".to_string());
        assert_eq!(id, 0);
        assert_eq!(v.get_request(0).unwrap().status, Status::Pending);
    }

    #[test]
    #[should_panic(expected = "per-transaction cap")]
    fn request_over_hard_cap_fails() {
        let mut v = vault();
        as_account(accounts(2));
        v.request_payment(accounts(3), U128(6 * N), "too much".to_string());
    }

    #[test]
    #[should_panic(expected = "only the agent")]
    fn stranger_cannot_request() {
        let mut v = vault();
        as_account(accounts(3));
        v.request_payment(accounts(3), U128(N), "x".to_string());
    }

    #[test]
    #[should_panic(expected = "only the guardian")]
    fn agent_cannot_approve_itself() {
        let mut v = vault();
        as_account(accounts(2));
        let id = v.request_payment(accounts(3), U128(N), "x".to_string());
        v.approve(id);
    }

    #[test]
    #[should_panic(expected = "daily cap")]
    fn daily_hard_cap_is_enforced() {
        let mut v = vault();
        as_account(accounts(2));
        for _ in 0..5 {
            v.request_payment(accounts(3), U128(5 * N), "x".to_string());
        }
        as_account(accounts(1));
        for id in 0..5 {
            v.approve(id); // 4 x 5 = 20 ok, the 5th exceeds 20
        }
    }
}
