use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, env,
    ext_contract, near, require,
};
use std::collections::HashMap;

const MAX_EPOCH_NS: u64 = 48 * 60 * 60 * 1_000_000_000;
const MAX_EDITION_WINDOW_NS: u64 = 7 * 24 * 60 * 60 * 1_000_000_000;
const MAX_ALLOWANCE: u16 = 256;
const MAX_BUILD_CREDIT_PRICE: NearToken = NearToken::from_near(10);
const MAX_BATCH_SIZE: usize = 16;
const MAX_PAGE_SIZE: u32 = 100;
const PALETTE_SIZE: u8 = 16;
const ACC_SCALE: u128 = 1_000_000_000_000;
const WITHDRAW_CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Pieces,
    Occupied,
    AllowanceUsed,
    DayPieceIds,
    DayPieces { day: u64 },
    ActivePieceCounts,
    ActiveCreditCounts,
    BuilderPieceCounts,
    BuilderCreditCounts,
    CreditBalances,
    Days,
    Claimed,
    Nft,
    NftTokenMetadata,
    NftEnumeration,
    NftMetadata,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlotSize {
    pub x: u8,
    pub y: u8,
    pub z: u8,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Config {
    pub treasury: AccountId,
    pub keeper: Option<AccountId>,
    pub epoch_len_ns: u64,
    pub edition_window_ns: u64,
    pub edition_price: NearToken,
    pub build_credit_price: NearToken,
    pub allowance_per_day: u16,
    pub plot_size: PlotSize,
    pub builders_bps: u16,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placement {
    pub shape: u8,
    pub rotation: u8,
    pub x: u8,
    pub y: u8,
    pub z: u8,
    pub color: u8,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Piece {
    pub id: u64,
    pub day: u64,
    pub owner: AccountId,
    pub placement: Placement,
}

#[near(serializers = [json])]
#[derive(Clone)]
pub struct ShapeView {
    pub id: u8,
    pub name: String,
    pub voxels: Vec<(i8, i8, i8)>,
    pub credits: u16,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct VoxelKey {
    day: u64,
    x: u8,
    y: u8,
    z: u8,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct AllowanceKey {
    day: u64,
    account_id: AccountId,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct DayAccountKey {
    day: u64,
    account_id: AccountId,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DayState {
    pub finalized_at_ns: u64,
    pub sale_ends_at_ns: u64,
    pub total_pieces: u32,
    pub total_credits: u32,
    pub edition_price: NearToken,
    pub editions_minted: u64,
    pub proceeds: NearToken,
    pub builder_pool: NearToken,
    pub acc_per_credit_scaled: U128,
    pub treasury_earned: NearToken,
    pub dust_swept: NearToken,
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ExtSelf {
    fn on_withdraw(&mut self, day: u64, account_id: AccountId, amount: U128) -> bool;
    fn on_treasury_withdraw(&mut self, amount: U128) -> bool;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    config: Config,
    genesis_ns: u64,
    next_piece_id: u64,
    pieces: LookupMap<u64, Piece>,
    occupied: LookupMap<VoxelKey, u64>,
    allowance_used: LookupMap<AllowanceKey, u16>,
    day_piece_ids: LookupMap<u64, Vector<u64>>,
    active_piece_counts: LookupMap<u64, u32>,
    active_credit_counts: LookupMap<u64, u32>,
    builder_piece_counts: LookupMap<DayAccountKey, u32>,
    builder_credit_counts: LookupMap<DayAccountKey, u32>,
    credit_balances: LookupMap<AccountId, u32>,
    days: LookupMap<u64, DayState>,
    claimed: LookupMap<DayAccountKey, u128>,
    treasury_balance: u128,
    tokens: NonFungibleToken,
    nft_metadata: LazyOption<NFTContractMetadata>,
    media_base_url: String,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        config: Config,
        collection_name: String,
        collection_symbol: String,
        media_base_url: String,
    ) -> Self {
        validate_config(&config);
        require!(
            !collection_name.trim().is_empty(),
            "Collection name is required"
        );
        require!(
            !collection_symbol.trim().is_empty(),
            "Collection symbol is required"
        );
        require!(
            media_base_url.starts_with("https://")
                || media_base_url.starts_with("http://localhost"),
            "Media base URL must use HTTPS or localhost"
        );
        let metadata = NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: collection_name,
            symbol: collection_symbol,
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        };
        metadata.assert_valid();

        Self {
            config,
            genesis_ns: env::block_timestamp(),
            next_piece_id: 0,
            pieces: LookupMap::new(StorageKey::Pieces),
            occupied: LookupMap::new(StorageKey::Occupied),
            allowance_used: LookupMap::new(StorageKey::AllowanceUsed),
            day_piece_ids: LookupMap::new(StorageKey::DayPieceIds),
            active_piece_counts: LookupMap::new(StorageKey::ActivePieceCounts),
            active_credit_counts: LookupMap::new(StorageKey::ActiveCreditCounts),
            builder_piece_counts: LookupMap::new(StorageKey::BuilderPieceCounts),
            builder_credit_counts: LookupMap::new(StorageKey::BuilderCreditCounts),
            credit_balances: LookupMap::new(StorageKey::CreditBalances),
            days: LookupMap::new(StorageKey::Days),
            claimed: LookupMap::new(StorageKey::Claimed),
            treasury_balance: 0,
            tokens: NonFungibleToken::new(
                StorageKey::Nft,
                env::current_account_id(),
                Some(StorageKey::NftTokenMetadata),
                Some(StorageKey::NftEnumeration),
                None::<StorageKey>,
            ),
            nft_metadata: LazyOption::new(StorageKey::NftMetadata, Some(&metadata)),
            media_base_url: media_base_url.trim_end_matches('/').to_string(),
        }
    }

    pub fn config(&self) -> Config {
        self.config.clone()
    }

    pub fn current_day(&self) -> u64 {
        env::block_timestamp().saturating_sub(self.genesis_ns) / self.config.epoch_len_ns
    }

    pub fn shapes(&self) -> Vec<ShapeView> {
        SHAPES
            .iter()
            .map(|shape| ShapeView {
                id: shape.id,
                name: shape.name.to_string(),
                voxels: shape.voxels.to_vec(),
                credits: shape.credits(),
            })
            .collect()
    }

    pub fn allowance_left(&self, account_id: AccountId, day: Option<u64>) -> u16 {
        let key = AllowanceKey {
            day: day.unwrap_or_else(|| self.current_day()),
            account_id,
        };
        self.config
            .allowance_per_day
            .saturating_sub(self.allowance_used.get(&key).copied().unwrap_or(0))
    }

    pub fn credit_balance(&self, account_id: AccountId) -> u32 {
        self.credit_balances.get(&account_id).copied().unwrap_or(0)
    }

    pub fn piece(&self, piece_id: u64) -> Option<Piece> {
        self.pieces.get(&piece_id).cloned()
    }

    pub fn pieces(&self, day: u64, from_index: u32, limit: u32) -> Vec<Piece> {
        let Some(ids) = self.day_piece_ids.get(&day) else {
            return Vec::new();
        };

        ids.iter()
            .skip(from_index as usize)
            .filter_map(|id| self.pieces.get(id).cloned())
            .take(limit.min(MAX_PAGE_SIZE) as usize)
            .collect()
    }

    pub fn voxel_piece(&self, day: u64, x: u8, y: u8, z: u8) -> Option<u64> {
        self.occupied.get(&VoxelKey { day, x, y, z }).copied()
    }

    pub fn day_state(&self, day: u64) -> Option<DayState> {
        self.days.get(&day).cloned()
    }

    pub fn builder_pieces(&self, day: u64, account_id: AccountId) -> u32 {
        self.builder_piece_counts
            .get(&DayAccountKey { day, account_id })
            .copied()
            .unwrap_or(0)
    }

    pub fn builder_credits(&self, day: u64, account_id: AccountId) -> u32 {
        self.builder_credit_counts
            .get(&DayAccountKey { day, account_id })
            .copied()
            .unwrap_or(0)
    }

    pub fn claimable(&self, day: u64, account_id: AccountId) -> NearToken {
        let Some(state) = self.days.get(&day) else {
            return NearToken::from_yoctonear(0);
        };
        let key = DayAccountKey { day, account_id };
        let credits = self.builder_credit_counts.get(&key).copied().unwrap_or(0);
        let earned = scaled_value(state.acc_per_credit_scaled.0, credits);
        NearToken::from_yoctonear(
            earned.saturating_sub(self.claimed.get(&key).copied().unwrap_or(0)),
        )
    }

    pub fn treasury_balance(&self) -> NearToken {
        NearToken::from_yoctonear(self.treasury_balance)
    }

    #[payable]
    pub fn buy_credits(&mut self, credits: u16) -> u32 {
        require!(credits > 0, "Credit purchase must be positive");
        let account_id = env::predecessor_account_id();
        let price = self
            .config
            .build_credit_price
            .as_yoctonear()
            .checked_mul(u128::from(credits))
            .unwrap_or_else(|| env::panic_str("Credit purchase overflow"));
        let storage_before = env::storage_usage();
        let next_balance = self
            .credit_balance(account_id.clone())
            .checked_add(u32::from(credits))
            .unwrap_or_else(|| env::panic_str("Credit balance overflow"));
        self.credit_balances
            .insert(account_id.clone(), next_balance);
        self.credit_balances.flush();
        let storage =
            storage_cost(env::storage_usage().saturating_sub(storage_before)).as_yoctonear();
        let required = price
            .checked_add(storage)
            .unwrap_or_else(|| env::panic_str("Credit purchase deposit overflow"));
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= required,
            "Insufficient deposit for credits and storage"
        );
        self.treasury_balance = self
            .treasury_balance
            .checked_add(price)
            .unwrap_or_else(|| env::panic_str("Treasury balance overflow"));
        let refund = attached.saturating_sub(required);
        if refund > 0 {
            Promise::new(account_id.clone())
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }
        emit_credits_purchased(&account_id, credits, price);
        next_balance
    }

    pub fn update_economics(
        &mut self,
        allowance_per_day: u16,
        build_credit_price: NearToken,
        edition_price: NearToken,
    ) {
        require!(
            env::predecessor_account_id() == self.config.treasury,
            "Only the treasury can update economics"
        );
        validate_economics(allowance_per_day, build_credit_price, edition_price);
        self.config.allowance_per_day = allowance_per_day;
        self.config.build_credit_price = build_credit_price;
        self.config.edition_price = edition_price;
        emit_economics_updated(&self.config);
    }

    pub fn finalize(&mut self, day: u64) -> DayState {
        require!(day < self.current_day(), "Day has not ended");
        require!(self.days.get(&day).is_none(), "Day is already finalized");
        let total_pieces = self.active_piece_counts.get(&day).copied().unwrap_or(0);
        require!(total_pieces > 0, "Cannot finalize an empty day");
        let total_credits = self.active_credit_counts.get(&day).copied().unwrap_or(0);

        let finalized_at_ns = env::block_timestamp();
        let state = DayState {
            finalized_at_ns,
            sale_ends_at_ns: finalized_at_ns.saturating_add(self.config.edition_window_ns),
            total_pieces,
            total_credits,
            edition_price: self.config.edition_price,
            editions_minted: 0,
            proceeds: NearToken::from_yoctonear(0),
            builder_pool: NearToken::from_yoctonear(0),
            acc_per_credit_scaled: U128(0),
            treasury_earned: NearToken::from_yoctonear(0),
            dust_swept: NearToken::from_yoctonear(0),
        };
        self.days.insert(day, state.clone());
        emit_day_finalized(day, &state);
        state
    }

    #[payable]
    pub fn collect(&mut self, day: u64) -> Token {
        let mut state = self
            .days
            .get(&day)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Day is not finalized"));
        require!(
            env::block_timestamp() < state.sale_ends_at_ns,
            "Edition sale has ended"
        );

        let price = state.edition_price.as_yoctonear();
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= price,
            "Attached deposit is below the edition price"
        );

        let serial = state
            .editions_minted
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("Edition serial overflow"));
        let token_id = format!("{day}:{serial}");
        let storage_before = env::storage_usage();
        let token = self.tokens.internal_mint(
            token_id.clone(),
            env::predecessor_account_id(),
            Some(TokenMetadata {
                title: Some(format!("Day {day} Edition #{serial}")),
                description: Some("A collected edition of a daily collaborative 3D build.".into()),
                media: Some(format!("{}/api/edition/{day}", self.media_base_url)),
                media_hash: None,
                copies: None,
                issued_at: Some(env::block_timestamp().to_string()),
                expires_at: None,
                starts_at: None,
                updated_at: None,
                extra: Some(format!("{{\"day\":{day},\"serial\":{serial}}}")),
                reference: None,
                reference_hash: None,
            }),
        );
        let storage_required =
            storage_cost(env::storage_usage().saturating_sub(storage_before)).as_yoctonear();
        let required = price
            .checked_add(storage_required)
            .unwrap_or_else(|| env::panic_str("Collect deposit overflow"));
        require!(
            attached >= required,
            "Attached deposit does not cover NFT storage"
        );

        let builder_target = price
            .checked_mul(u128::from(self.config.builders_bps))
            .unwrap_or_else(|| env::panic_str("Builder share overflow"))
            / 10_000;
        let acc_increment = scaled_per_piece(builder_target, state.total_credits);
        let treasury = price.saturating_sub(builder_target);

        state.editions_minted = serial;
        state.proceeds = NearToken::from_yoctonear(
            state
                .proceeds
                .as_yoctonear()
                .checked_add(price)
                .unwrap_or_else(|| env::panic_str("Proceeds overflow")),
        );
        state.acc_per_credit_scaled = U128(
            state
                .acc_per_credit_scaled
                .0
                .checked_add(acc_increment)
                .unwrap_or_else(|| env::panic_str("Reward accumulator overflow")),
        );
        state.builder_pool = NearToken::from_yoctonear(
            state
                .builder_pool
                .as_yoctonear()
                .checked_add(builder_target)
                .unwrap_or_else(|| env::panic_str("Builder pool overflow")),
        );
        state.treasury_earned = NearToken::from_yoctonear(
            state
                .treasury_earned
                .as_yoctonear()
                .checked_add(treasury)
                .unwrap_or_else(|| env::panic_str("Treasury earnings overflow")),
        );
        self.treasury_balance = self
            .treasury_balance
            .checked_add(treasury)
            .unwrap_or_else(|| env::panic_str("Treasury balance overflow"));
        self.days.insert(day, state);
        emit_edition_collected(day, serial, &token_id, price);

        let refund = attached.saturating_sub(required);
        if refund > 0 {
            Promise::new(env::predecessor_account_id())
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }
        token
    }

    pub fn sweep_dust(&mut self, day: u64) -> NearToken {
        let mut state = self
            .days
            .get(&day)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Day is not finalized"));
        require!(
            env::block_timestamp() >= state.sale_ends_at_ns,
            "Edition sale is still open"
        );
        let maximum_liability = scaled_value(state.acc_per_credit_scaled.0, state.total_credits);
        let total_dust = state
            .builder_pool
            .as_yoctonear()
            .saturating_sub(maximum_liability);
        let unswept = total_dust.saturating_sub(state.dust_swept.as_yoctonear());
        if unswept > 0 {
            state.dust_swept = NearToken::from_yoctonear(total_dust);
            state.treasury_earned = NearToken::from_yoctonear(
                state
                    .treasury_earned
                    .as_yoctonear()
                    .checked_add(unswept)
                    .unwrap_or_else(|| env::panic_str("Treasury earnings overflow")),
            );
            self.treasury_balance = self
                .treasury_balance
                .checked_add(unswept)
                .unwrap_or_else(|| env::panic_str("Treasury balance overflow"));
            self.days.insert(day, state);
        }
        NearToken::from_yoctonear(unswept)
    }

    pub fn withdraw(&mut self, day: u64) -> Promise {
        let account_id = env::predecessor_account_id();
        let amount = self.claimable(day, account_id.clone()).as_yoctonear();
        require!(amount > 0, "Nothing to withdraw");
        let key = DayAccountKey {
            day,
            account_id: account_id.clone(),
        };
        let claimed = self.claimed.get(&key).copied().unwrap_or(0);
        self.claimed.insert(
            key,
            claimed
                .checked_add(amount)
                .unwrap_or_else(|| env::panic_str("Claimed amount overflow")),
        );

        Promise::new(account_id.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(WITHDRAW_CALLBACK_GAS)
                    .on_withdraw(day, account_id, U128(amount)),
            )
    }

    pub fn withdraw_treasury(&mut self) -> Promise {
        require!(
            env::predecessor_account_id() == self.config.treasury,
            "Only the treasury can withdraw"
        );
        let amount = self.treasury_balance;
        require!(amount > 0, "Nothing to withdraw");
        self.treasury_balance = 0;

        Promise::new(self.config.treasury.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(WITHDRAW_CALLBACK_GAS)
                    .on_treasury_withdraw(U128(amount)),
            )
    }

    #[private]
    pub fn on_withdraw(&mut self, day: u64, account_id: AccountId, amount: U128) -> bool {
        require!(
            env::promise_results_count() == 1,
            "Expected one promise result"
        );
        if env::promise_result_checked(0, 1024).is_ok() {
            emit_withdrawn(day, &account_id, amount.0);
            return true;
        }

        let key = DayAccountKey { day, account_id };
        let claimed = self.claimed.get(&key).copied().unwrap_or(0);
        self.claimed.insert(key, claimed.saturating_sub(amount.0));
        false
    }

    #[private]
    pub fn on_treasury_withdraw(&mut self, amount: U128) -> bool {
        require!(
            env::promise_results_count() == 1,
            "Expected one promise result"
        );
        if env::promise_result_checked(0, 1024).is_ok() {
            return true;
        }
        self.treasury_balance = self
            .treasury_balance
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("Treasury balance overflow"));
        false
    }

    #[payable]
    pub fn place(&mut self, placement: Placement) -> u64 {
        self.place_many(vec![placement])
            .into_iter()
            .next()
            .expect("one placement always returns one piece id")
    }

    #[payable]
    pub fn place_many(&mut self, placements: Vec<Placement>) -> Vec<u64> {
        require!(!placements.is_empty(), "At least one placement is required");
        require!(
            placements.len() <= MAX_BATCH_SIZE,
            "Batch exceeds 16 pieces"
        );

        let day = self.current_day();
        let owner = env::predecessor_account_id();
        let key = AllowanceKey {
            day,
            account_id: owner.clone(),
        };
        let used = self.allowance_used.get(&key).copied().unwrap_or(0);
        let requested = u16::try_from(placements.len()).expect("batch size fits in u16");
        let free = requested.min(self.config.allowance_per_day.saturating_sub(used));
        let paid_credits = placements
            .iter()
            .skip(usize::from(free))
            .try_fold(0_u32, |total, placement| {
                total.checked_add(u32::from(placement_credits(placement.shape)))
            })
            .unwrap_or_else(|| env::panic_str("Build credit total overflow"));
        let balance = self.credit_balance(owner.clone());
        require!(balance >= paid_credits, "Not enough build credits");

        let storage_before = env::storage_usage();
        let mut ids = Vec::with_capacity(placements.len());
        for placement in placements {
            ids.push(self.place_one(day, &owner, placement));
        }
        self.allowance_used.insert(key, used.saturating_add(free));
        if paid_credits > 0 {
            self.credit_balances.insert(owner, balance - paid_credits);
        }
        self.charge_storage(day, storage_before);

        ids
    }

    pub fn remove(&mut self, piece_id: u64) {
        let storage_before = env::storage_usage();
        let piece = self
            .pieces
            .get(&piece_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Piece not found"));
        require!(
            piece.owner == env::predecessor_account_id(),
            "Only the piece owner can remove it"
        );
        require!(piece.day == self.current_day(), "Past days are immutable");

        for voxel in occupied_voxels(piece.day, piece.placement) {
            self.occupied.remove(&voxel);
        }
        self.pieces.remove(&piece_id);
        let active = self
            .active_piece_counts
            .get(&piece.day)
            .copied()
            .unwrap_or_else(|| env::panic_str("Missing day piece count"));
        self.active_piece_counts
            .insert(piece.day, active.saturating_sub(1));
        let credits = u32::from(placement_credits(piece.placement.shape));
        let active_credits = self
            .active_credit_counts
            .get(&piece.day)
            .copied()
            .unwrap_or_else(|| env::panic_str("Missing day credit count"));
        self.active_credit_counts
            .insert(piece.day, active_credits.saturating_sub(credits));
        let builder_key = DayAccountKey {
            day: piece.day,
            account_id: piece.owner.clone(),
        };
        let builder_pieces = self
            .builder_piece_counts
            .get(&builder_key)
            .copied()
            .unwrap_or_else(|| env::panic_str("Missing builder piece count"));
        self.builder_piece_counts
            .insert(builder_key, builder_pieces.saturating_sub(1));
        let builder_credit_key = DayAccountKey {
            day: piece.day,
            account_id: piece.owner.clone(),
        };
        let builder_credits = self
            .builder_credit_counts
            .get(&builder_credit_key)
            .copied()
            .unwrap_or_else(|| env::panic_str("Missing builder credit count"));
        self.builder_credit_counts
            .insert(builder_credit_key, builder_credits.saturating_sub(credits));
        emit_piece_removed(&piece);
        self.pieces.flush();
        self.occupied.flush();
        self.active_piece_counts.flush();
        self.active_credit_counts.flush();
        self.builder_piece_counts.flush();
        self.builder_credit_counts.flush();

        let released = storage_before.saturating_sub(env::storage_usage());
        if released > 0 {
            Promise::new(piece.owner)
                .transfer(storage_cost(released))
                .detach();
        }
    }
}

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.tokens
            .nft_transfer(receiver_id, token_id, approval_id, memo);
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.nft_metadata
            .get()
            .unwrap_or_else(|| env::panic_str("Missing NFT metadata"))
    }
}

impl Contract {
    fn place_one(&mut self, day: u64, owner: &AccountId, placement: Placement) -> u64 {
        require!(placement.rotation < 4, "Rotation must be between 0 and 3");
        require!(placement.color < PALETTE_SIZE, "Invalid palette color");
        require!(shape(placement.shape).is_some(), "Unknown shape");

        let voxels = occupied_voxels(day, placement);
        require!(
            voxels.iter().all(|voxel| {
                voxel.x < self.config.plot_size.x
                    && voxel.y < self.config.plot_size.y
                    && voxel.z < self.config.plot_size.z
            }),
            "Piece is outside the plot"
        );
        require!(
            voxels
                .iter()
                .all(|voxel| self.occupied.get(voxel).is_none()),
            "Piece overlaps an occupied voxel"
        );
        require!(
            voxels.iter().any(|voxel| {
                voxel.y == 0
                    || self
                        .occupied
                        .get(&VoxelKey {
                            day,
                            x: voxel.x,
                            y: voxel.y.saturating_sub(1),
                            z: voxel.z,
                        })
                        .is_some()
                    || voxel.y.checked_add(1).is_some_and(|y| {
                        self.occupied
                            .get(&VoxelKey {
                                day,
                                x: voxel.x,
                                y,
                                z: voxel.z,
                            })
                            .is_some()
                    })
            }),
            "Piece must touch the ground or an existing piece vertically"
        );

        let id = self.next_piece_id;
        self.next_piece_id = self
            .next_piece_id
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str("Piece id overflow"));
        let piece = Piece {
            id,
            day,
            owner: owner.clone(),
            placement,
        };

        for voxel in voxels {
            self.occupied.insert(voxel, id);
        }
        self.pieces.insert(id, piece.clone());
        if let Some(ids) = self.day_piece_ids.get_mut(&day) {
            ids.push(id);
        } else {
            let mut ids = Vector::new(StorageKey::DayPieces { day });
            ids.push(id);
            self.day_piece_ids.insert(day, ids);
        }
        let active = self.active_piece_counts.get(&day).copied().unwrap_or(0);
        self.active_piece_counts.insert(
            day,
            active
                .checked_add(1)
                .unwrap_or_else(|| env::panic_str("Day piece count overflow")),
        );
        let builder_key = DayAccountKey {
            day,
            account_id: owner.clone(),
        };
        let builder_pieces = self
            .builder_piece_counts
            .get(&builder_key)
            .copied()
            .unwrap_or(0);
        self.builder_piece_counts.insert(
            builder_key,
            builder_pieces
                .checked_add(1)
                .unwrap_or_else(|| env::panic_str("Builder piece count overflow")),
        );
        let credits = u32::from(placement_credits(placement.shape));
        let active_credits = self.active_credit_counts.get(&day).copied().unwrap_or(0);
        self.active_credit_counts.insert(
            day,
            active_credits
                .checked_add(credits)
                .unwrap_or_else(|| env::panic_str("Day credit count overflow")),
        );
        let builder_credit_key = DayAccountKey {
            day,
            account_id: owner.clone(),
        };
        let builder_credits = self
            .builder_credit_counts
            .get(&builder_credit_key)
            .copied()
            .unwrap_or(0);
        self.builder_credit_counts.insert(
            builder_credit_key,
            builder_credits
                .checked_add(credits)
                .unwrap_or_else(|| env::panic_str("Builder credit count overflow")),
        );
        emit_piece_placed(&piece);

        id
    }

    fn charge_storage(&mut self, day: u64, storage_before: u64) {
        self.pieces.flush();
        self.occupied.flush();
        self.allowance_used.flush();
        self.active_piece_counts.flush();
        self.active_credit_counts.flush();
        self.builder_piece_counts.flush();
        self.builder_credit_counts.flush();
        self.credit_balances.flush();
        self.day_piece_ids
            .get_mut(&day)
            .expect("day piece index exists after placement")
            .flush();
        self.day_piece_ids.flush();

        let used = env::storage_usage().saturating_sub(storage_before);
        let required = storage_cost(used);
        let attached = env::attached_deposit();
        require!(attached >= required, "Insufficient deposit for storage");

        let refund = attached.saturating_sub(required);
        if !refund.is_zero() {
            Promise::new(env::predecessor_account_id())
                .transfer(refund)
                .detach();
        }
    }
}

const BRICK_1X1: &[(i8, i8, i8)] = &[(0, 0, 0)];
const BRICK_1X2: &[(i8, i8, i8)] = &[(0, 0, 0), (1, 0, 0)];
const BRICK_2X2: &[(i8, i8, i8)] = &[(0, 0, 0), (1, 0, 0), (0, 0, 1), (1, 0, 1)];
const BRICK_2X4: &[(i8, i8, i8)] = &[
    (0, 0, 0),
    (1, 0, 0),
    (2, 0, 0),
    (3, 0, 0),
    (0, 0, 1),
    (1, 0, 1),
    (2, 0, 1),
    (3, 0, 1),
];

struct Shape {
    id: u8,
    name: &'static str,
    voxels: &'static [(i8, i8, i8)],
}

impl Shape {
    fn credits(&self) -> u16 {
        u16::try_from(self.voxels.len()).expect("shape voxel count fits in u16")
    }
}

const SHAPES: &[Shape] = &[
    Shape {
        id: 0,
        name: "1x1 brick",
        voxels: BRICK_1X1,
    },
    Shape {
        id: 1,
        name: "1x2 brick",
        voxels: BRICK_1X2,
    },
    Shape {
        id: 2,
        name: "2x2 brick",
        voxels: BRICK_2X2,
    },
    Shape {
        id: 3,
        name: "2x4 brick",
        voxels: BRICK_2X4,
    },
    Shape {
        id: 4,
        name: "1x1 cylinder",
        voxels: BRICK_1X1,
    },
    Shape {
        id: 5,
        name: "1x1 slope",
        voxels: BRICK_1X1,
    },
];

fn shape(shape_id: u8) -> Option<&'static Shape> {
    SHAPES.iter().find(|shape| shape.id == shape_id)
}

fn placement_credits(shape_id: u8) -> u16 {
    shape(shape_id)
        .unwrap_or_else(|| env::panic_str("Unknown shape"))
        .credits()
}

fn occupied_voxels(day: u64, placement: Placement) -> Vec<VoxelKey> {
    let offsets = shape(placement.shape)
        .unwrap_or_else(|| env::panic_str("Unknown shape"))
        .voxels;
    let rotated: Vec<(i8, i8, i8)> = offsets
        .iter()
        .map(|&(x, y, z)| rotate(x, y, z, placement.rotation))
        .collect();
    let min_x = rotated.iter().map(|(x, _, _)| *x).min().unwrap_or(0);
    let min_z = rotated.iter().map(|(_, _, z)| *z).min().unwrap_or(0);

    rotated
        .into_iter()
        .map(|(x, y, z)| VoxelKey {
            day,
            x: offset_coordinate(placement.x, x - min_x),
            y: offset_coordinate(placement.y, y),
            z: offset_coordinate(placement.z, z - min_z),
        })
        .collect()
}

fn rotate(x: i8, y: i8, z: i8, rotation: u8) -> (i8, i8, i8) {
    match rotation {
        0 => (x, y, z),
        1 => (z, y, -x),
        2 => (-x, y, -z),
        3 => (-z, y, x),
        _ => env::panic_str("Rotation must be between 0 and 3"),
    }
}

fn offset_coordinate(origin: u8, offset: i8) -> u8 {
    let coordinate = i16::from(origin) + i16::from(offset);
    u8::try_from(coordinate).unwrap_or(u8::MAX)
}

fn storage_cost(bytes: u64) -> NearToken {
    NearToken::from_yoctonear(
        u128::from(bytes).saturating_mul(env::storage_byte_cost().as_yoctonear()),
    )
}

fn scaled_per_piece(amount: u128, pieces: u32) -> u128 {
    let pieces = u128::from(pieces);
    amount
        .checked_div(pieces)
        .and_then(|whole| whole.checked_mul(ACC_SCALE))
        .and_then(|scaled| {
            amount
                .checked_rem(pieces)
                .and_then(|remainder| remainder.checked_mul(ACC_SCALE))
                .and_then(|remainder| remainder.checked_div(pieces))
                .and_then(|remainder| scaled.checked_add(remainder))
        })
        .unwrap_or_else(|| env::panic_str("Reward calculation overflow"))
}

fn scaled_value(accumulator: u128, pieces: u32) -> u128 {
    let pieces = u128::from(pieces);
    accumulator
        .checked_div(ACC_SCALE)
        .and_then(|whole| whole.checked_mul(pieces))
        .and_then(|value| {
            accumulator
                .checked_rem(ACC_SCALE)
                .and_then(|remainder| remainder.checked_mul(pieces))
                .and_then(|remainder| remainder.checked_div(ACC_SCALE))
                .and_then(|remainder| value.checked_add(remainder))
        })
        .unwrap_or_else(|| env::panic_str("Claim calculation overflow"))
}

fn validate_config(config: &Config) {
    require!(config.epoch_len_ns > 0, "Epoch length must be positive");
    require!(
        config.epoch_len_ns <= MAX_EPOCH_NS,
        "Epoch length exceeds 48 hours"
    );
    require!(
        config.edition_window_ns > 0,
        "Edition window must be positive"
    );
    require!(
        config.edition_window_ns <= MAX_EDITION_WINDOW_NS,
        "Edition window exceeds 7 days"
    );
    validate_economics(
        config.allowance_per_day,
        config.build_credit_price,
        config.edition_price,
    );
    require!(config.builders_bps == 9_000, "Builder share must be 90%");
    require!(
        config.plot_size.x > 0 && config.plot_size.y > 0 && config.plot_size.z > 0,
        "Plot dimensions must be positive"
    );
    require!(
        config.plot_size.x <= 64 && config.plot_size.y <= 64 && config.plot_size.z <= 64,
        "Plot dimensions exceed 64 voxels"
    );
}

fn validate_economics(
    allowance_per_day: u16,
    build_credit_price: NearToken,
    edition_price: NearToken,
) {
    require!(allowance_per_day <= MAX_ALLOWANCE, "Allowance is too large");
    require!(
        !build_credit_price.is_zero(),
        "Build credit price must be positive"
    );
    require!(
        build_credit_price <= MAX_BUILD_CREDIT_PRICE,
        "Build credit price exceeds 10 NEAR"
    );
    require!(!edition_price.is_zero(), "Edition price must be positive");
    require!(
        edition_price <= NearToken::from_near(100),
        "Edition price exceeds 100 NEAR"
    );
}

fn emit_piece_placed(piece: &Piece) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"daily_build\",\"version\":\"1.0.0\",\"event\":\"piece_placed\",\"data\":[{{\"piece_id\":\"{}\",\"day\":\"{}\",\"owner\":\"{}\"}}]}}",
        piece.id, piece.day, piece.owner
    ));
}

fn emit_piece_removed(piece: &Piece) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"daily_build\",\"version\":\"1.0.0\",\"event\":\"piece_removed\",\"data\":[{{\"piece_id\":\"{}\",\"day\":\"{}\",\"owner\":\"{}\"}}]}}",
        piece.id, piece.day, piece.owner
    ));
}

fn emit_day_finalized(day: u64, state: &DayState) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"daily_build\",\"version\":\"1.0.0\",\"event\":\"day_finalized\",\"data\":[{{\"day\":\"{day}\",\"total_pieces\":\"{}\",\"sale_ends_at_ns\":\"{}\"}}]}}",
        state.total_pieces, state.sale_ends_at_ns
    ));
}

fn emit_edition_collected(day: u64, serial: u64, token_id: &str, price: u128) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"daily_build\",\"version\":\"1.0.0\",\"event\":\"edition_collected\",\"data\":[{{\"day\":\"{day}\",\"serial\":\"{serial}\",\"token_id\":\"{token_id}\",\"price\":\"{price}\"}}]}}"
    ));
}

fn emit_withdrawn(day: u64, account_id: &AccountId, amount: u128) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"daily_build\",\"version\":\"1.0.0\",\"event\":\"withdrawn\",\"data\":[{{\"day\":\"{day}\",\"account_id\":\"{account_id}\",\"amount\":\"{amount}\"}}]}}"
    ));
}

fn emit_credits_purchased(account_id: &AccountId, credits: u16, amount: u128) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"daily_build\",\"version\":\"1.0.0\",\"event\":\"credits_purchased\",\"data\":[{{\"account_id\":\"{account_id}\",\"credits\":\"{credits}\",\"amount\":\"{amount}\"}}]}}"
    ));
}

fn emit_economics_updated(config: &Config) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"daily_build\",\"version\":\"1.0.0\",\"event\":\"economics_updated\",\"data\":[{{\"allowance_per_day\":\"{}\",\"build_credit_price\":\"{}\",\"edition_price\":\"{}\"}}]}}",
        config.allowance_per_day,
        config.build_credit_price.as_yoctonear(),
        config.edition_price.as_yoctonear()
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::{VMContextBuilder, accounts, get_created_receipts};
    use near_sdk::testing_env;

    const EPOCH_NS: u64 = 300_000_000_000;

    fn config(allowance_per_day: u16) -> Config {
        Config {
            treasury: accounts(5),
            keeper: None,
            epoch_len_ns: EPOCH_NS,
            edition_window_ns: 86_400_000_000_000,
            edition_price: NearToken::from_near(1),
            build_credit_price: NearToken::from_millinear(10),
            allowance_per_day,
            plot_size: PlotSize { x: 8, y: 8, z: 8 },
            builders_bps: 9_000,
        }
    }

    fn context(account: AccountId, timestamp: u64) -> VMContextBuilder {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(accounts(0))
            .signer_account_id(account.clone())
            .predecessor_account_id(account)
            .block_timestamp(timestamp)
            .attached_deposit(NearToken::from_near(10));
        builder
    }

    fn contract(allowance_per_day: u16) -> Contract {
        testing_env!(context(accounts(1), 1_000).build());
        Contract::new(
            config(allowance_per_day),
            "Test Collection".into(),
            "TEST".into(),
            "http://localhost:3000".into(),
        )
    }

    #[test]
    #[should_panic(expected = "Builder share must be 90%")]
    fn rejects_unapproved_revenue_split() {
        testing_env!(context(accounts(1), 1_000).build());
        let mut config = config(1);
        config.builders_bps = 8_000;

        Contract::new(
            config,
            "Test Collection".into(),
            "TEST".into(),
            "http://localhost:3000".into(),
        );
    }

    #[test]
    fn treasury_can_update_bounded_economics() {
        let mut contract = contract(1);
        testing_env!(context(accounts(5), 1_000).build());

        contract.update_economics(
            2,
            NearToken::from_millinear(20),
            NearToken::from_millinear(100),
        );

        assert_eq!(contract.config.allowance_per_day, 2);
        assert_eq!(
            contract.config.build_credit_price,
            NearToken::from_millinear(20)
        );
    }

    fn placement(shape: u8, rotation: u8, x: u8, y: u8, z: u8) -> Placement {
        Placement {
            shape,
            rotation,
            x,
            y,
            z,
            color: 0,
        }
    }

    fn finalized_contract() -> Contract {
        let mut contract = contract(2);
        contract.place(placement(0, 0, 0, 0, 0));
        testing_env!(context(accounts(2), 1_000).build());
        contract.place(placement(0, 0, 1, 0, 0));
        testing_env!(context(accounts(3), 1_000 + EPOCH_NS).build());
        contract.finalize(0);
        contract
    }

    #[test]
    fn places_supported_piece_and_tracks_voxels() {
        let mut contract = contract(4);

        let base = contract.place(placement(0, 0, 2, 0, 2));
        let top = contract.place(placement(1, 0, 2, 1, 2));

        assert_eq!(contract.voxel_piece(0, 2, 0, 2), Some(base));
        assert_eq!(contract.voxel_piece(0, 2, 1, 2), Some(top));
        assert_eq!(contract.voxel_piece(0, 3, 1, 2), Some(top));
        assert_eq!(contract.pieces(0, 0, 10).len(), 2);
    }

    #[test]
    fn slope_occupies_one_voxel() {
        let mut contract = contract(1);
        let piece_id = contract.place(placement(5, 0, 2, 0, 2));

        assert_eq!(contract.voxel_piece(0, 2, 0, 2), Some(piece_id));
        assert_eq!(contract.voxel_piece(0, 3, 0, 2), None);
    }

    #[test]
    fn all_four_rotations_are_normalized_to_the_origin() {
        let mut contract = contract(4);
        for rotation in 0..4 {
            let x = rotation * 2;
            contract.place(placement(1, rotation, x, 0, 2));

            assert_eq!(contract.voxel_piece(0, x, 0, 2), Some(u64::from(rotation)));
            let second = if rotation % 2 == 0 {
                (x + 1, 2)
            } else {
                (x, 3)
            };
            assert_eq!(
                contract.voxel_piece(0, second.0, 0, second.1),
                Some(u64::from(rotation))
            );
        }
    }

    #[test]
    #[should_panic(expected = "Piece is outside the plot")]
    fn rejects_out_of_bounds_piece() {
        let mut contract = contract(1);
        contract.place(placement(3, 0, 7, 0, 7));
    }

    #[test]
    #[should_panic(expected = "Piece overlaps an occupied voxel")]
    fn rejects_overlap() {
        let mut contract = contract(2);
        contract.place(placement(0, 0, 1, 0, 1));
        contract.place(placement(0, 0, 1, 0, 1));
    }

    #[test]
    #[should_panic(expected = "Piece must touch the ground")]
    fn rejects_floating_piece() {
        let mut contract = contract(1);
        contract.place(placement(0, 0, 1, 2, 1));
    }

    #[test]
    fn allowance_resets_on_the_next_day() {
        let mut contract = contract(1);
        contract.place(placement(0, 0, 0, 0, 0));
        assert_eq!(contract.allowance_left(accounts(1), None), 0);

        testing_env!(context(accounts(1), 1_000 + EPOCH_NS).build());
        assert_eq!(contract.current_day(), 1);
        assert_eq!(contract.allowance_left(accounts(1), None), 1);
        contract.place(placement(0, 0, 0, 0, 0));
    }

    #[test]
    fn purchased_credits_carry_and_pay_for_later_pieces() {
        let mut contract = contract(1);
        contract.place(placement(0, 0, 0, 0, 0));
        contract.buy_credits(8);
        assert_eq!(contract.credit_balance(accounts(1)), 8);

        contract.place(placement(3, 0, 1, 0, 0));

        assert_eq!(contract.treasury_balance(), NearToken::from_millinear(80));
        assert_eq!(contract.credit_balance(accounts(1)), 0);
        assert_eq!(contract.allowance_left(accounts(1), None), 0);
    }

    #[test]
    #[should_panic(expected = "Insufficient deposit for storage")]
    fn requires_actual_storage_deposit() {
        let mut contract = contract(1);
        let mut zero_deposit = context(accounts(1), 1_000);
        zero_deposit.attached_deposit(NearToken::from_yoctonear(0));
        testing_env!(zero_deposit.build());

        contract.place(placement(0, 0, 0, 0, 0));
    }

    #[test]
    #[should_panic(expected = "Not enough build credits")]
    fn second_piece_requires_purchased_credits() {
        let mut contract = contract(1);
        contract.place(placement(0, 0, 0, 0, 0));
        contract.place(placement(0, 0, 1, 0, 0));
    }

    #[test]
    fn owner_can_remove_current_piece() {
        let mut contract = contract(1);
        let id = contract.place(placement(0, 0, 1, 0, 1));

        contract.remove(id);

        assert_eq!(contract.piece(id), None);
        assert_eq!(contract.voxel_piece(0, 1, 0, 1), None);
    }

    #[test]
    #[should_panic(expected = "Only the piece owner")]
    fn other_account_cannot_remove_piece() {
        let mut contract = contract(1);
        let id = contract.place(placement(0, 0, 1, 0, 1));
        testing_env!(context(accounts(2), 1_000).build());

        contract.remove(id);
    }

    #[test]
    #[should_panic(expected = "Day has not ended")]
    fn finalize_rejects_current_day() {
        let mut contract = contract(1);
        contract.place(placement(0, 0, 0, 0, 0));
        contract.finalize(0);
    }

    #[test]
    #[should_panic(expected = "Day is already finalized")]
    fn finalize_rejects_second_call() {
        let mut contract = finalized_contract();
        contract.finalize(0);
    }

    #[test]
    #[should_panic(expected = "Day is not finalized")]
    fn collect_rejects_unfinalized_day() {
        let mut contract = contract(1);
        contract.collect(0);
    }

    #[test]
    #[should_panic(expected = "Attached deposit does not cover NFT storage")]
    fn collect_requires_price_plus_storage() {
        let mut contract = finalized_contract();
        let mut buyer = context(accounts(3), 1_000 + EPOCH_NS);
        buyer.attached_deposit(contract.config.edition_price);
        testing_env!(buyer.build());
        contract.collect(0);
    }

    #[test]
    #[should_panic(expected = "Edition sale has ended")]
    fn collect_rejects_after_sale_window() {
        let mut contract = finalized_contract();
        let sale_end = contract.day_state(0).unwrap().sale_ends_at_ns;
        testing_env!(context(accounts(3), sale_end).build());
        contract.collect(0);
    }

    #[test]
    fn collect_mints_nft_refunds_excess_and_preserves_payout_invariant() {
        let mut contract = finalized_contract();
        let buyer_id = accounts(3);
        testing_env!(context(buyer_id.clone(), 1_000 + EPOCH_NS).build());

        let token = contract.collect(0);

        assert_eq!(token.token_id, "0:1");
        assert_eq!(token.owner_id, buyer_id);
        assert_eq!(contract.nft_total_supply(), U128(1));
        let bob = contract.claimable(0, accounts(1)).as_yoctonear();
        let charlie = contract.claimable(0, accounts(2)).as_yoctonear();
        let treasury = contract.treasury_balance().as_yoctonear();
        assert_eq!(
            bob.checked_add(charlie)
                .unwrap()
                .checked_add(treasury)
                .unwrap(),
            contract.config.edition_price.as_yoctonear()
        );
        assert!(get_created_receipts().iter().any(|receipt| {
            receipt.receiver_id == accounts(3)
                && receipt
                    .actions
                    .iter()
                    .any(|action| matches!(action, MockAction::Transfer { .. }))
        }));
    }

    #[test]
    fn edition_rewards_follow_shape_credit_weight() {
        let mut contract = contract(1);
        contract.place(placement(3, 0, 0, 0, 0));
        testing_env!(context(accounts(2), 1_000).build());
        contract.place(placement(0, 0, 4, 0, 0));
        testing_env!(context(accounts(3), 1_000 + EPOCH_NS).build());
        contract.finalize(0);
        contract.collect(0);

        let large_piece = contract.claimable(0, accounts(1)).as_yoctonear();
        let small_piece = contract.claimable(0, accounts(2)).as_yoctonear();
        assert_eq!(large_piece, small_piece * 8);
    }

    #[test]
    #[should_panic(expected = "Nothing to withdraw")]
    fn withdraw_cannot_double_pay() {
        let mut contract = finalized_contract();
        testing_env!(context(accounts(3), 1_000 + EPOCH_NS).build());
        contract.collect(0);
        testing_env!(context(accounts(1), 1_000 + EPOCH_NS).build());

        let _ = contract.withdraw(0);
        let _ = contract.withdraw(0);
    }

    #[test]
    fn accumulator_never_allocates_more_than_builder_pool() {
        let sale_share = 900_000_000_000_000_000_000_001_u128;
        let pieces = 3;
        let sales = 7_u128;
        let accumulator = scaled_per_piece(sale_share, pieces)
            .checked_mul(sales)
            .unwrap();
        let total_claims = scaled_value(accumulator, 1)
            .checked_mul(u128::from(pieces))
            .unwrap();

        assert!(total_claims <= sale_share * sales);
        assert!(sale_share * sales - total_claims <= u128::from(pieces));
    }

    #[test]
    fn dust_can_be_swept_once_after_sale_closes() {
        let mut contract = contract(7);
        for x in 0..7 {
            contract.place(placement(0, 0, x, 0, 0));
        }
        testing_env!(context(accounts(3), 1_000 + EPOCH_NS).build());
        contract.finalize(0);
        contract.collect(0);
        let sale_end = contract.day_state(0).unwrap().sale_ends_at_ns;
        testing_env!(context(accounts(4), sale_end).build());
        let treasury_before = contract.treasury_balance();

        let swept = contract.sweep_dust(0);

        assert!(swept <= NearToken::from_yoctonear(1));
        assert_eq!(
            contract.treasury_balance(),
            treasury_before.saturating_add(swept)
        );
        assert!(contract.sweep_dust(0).is_zero());
    }
}
