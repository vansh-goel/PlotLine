use near_api::{AccountId, NearToken};
use near_sdk::serde_json::{Value, json};

#[tokio::test]
async fn place_finalize_collect_and_withdraw() -> testresult::TestResult<()> {
    let wasm_path = cargo_near_build::build_with_cli(Default::default())?;
    let wasm = std::fs::read(wasm_path)?;
    let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
    let network = near_api::NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let builder = create_account(&sandbox, "builder.sandbox").await?;
    let buyer = create_account(&sandbox, "buyer.sandbox").await?;
    let treasury = create_account(&sandbox, "treasury.sandbox").await?;
    let contract = create_account(&sandbox, "contract.sandbox")
        .await?
        .as_contract();
    let signer = near_api::Signer::from_secret_key(
        near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
    )?;

    near_api::Contract::deploy(contract.account_id().clone())
        .use_code(wasm)
        .with_init_call(
            "new",
            json!({
                "config": {
                    "treasury": treasury.account_id(),
                    "keeper": null,
                    "epoch_len_ns": 5_000_000_000_u64,
                    "edition_window_ns": 60_000_000_000_u64,
                    "edition_price": NearToken::from_millinear(100),
                    "build_credit_price": NearToken::from_millinear(10),
                    "allowance_per_day": 8,
                    "plot_size": { "x": 8, "y": 8, "z": 8 },
                    "builders_bps": 9_000
                },
                "collection_name": "Test Daily Build",
                "collection_symbol": "TDB",
                "media_base_url": "http://localhost:3000"
            }),
        )?
        .with_signer(signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    contract
        .call_function(
            "place",
            json!({
                "placement": { "shape": 0, "rotation": 0, "x": 0, "y": 0, "z": 0, "color": 0 }
            }),
        )
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(builder.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let day: u64 = contract
        .call_function("current_day", ())
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    sandbox.fast_forward(20).await?;

    contract
        .call_function("finalize", json!({ "day": day }))
        .transaction()
        .with_signer(builder.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    contract
        .call_function("collect", json!({ "day": day }))
        .transaction()
        .deposit(NearToken::from_near(1))
        .with_signer(buyer.account_id().clone(), signer.clone())
        .send_to(&network)
        .await?
        .assert_success();

    let token: Option<Value> = contract
        .call_function("nft_token", json!({ "token_id": format!("{day}:1") }))
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert_eq!(
        token.and_then(|token| token["owner_id"].as_str().map(str::to_owned)),
        Some(buyer.account_id().to_string())
    );

    contract
        .call_function("withdraw", json!({ "day": day }))
        .transaction()
        .with_signer(builder.account_id().clone(), signer)
        .send_to(&network)
        .await?
        .assert_success();

    let claimable: NearToken = contract
        .call_function(
            "claimable",
            json!({ "day": day, "account_id": builder.account_id() }),
        )
        .read_only()
        .fetch_from(&network)
        .await?
        .data;
    assert!(claimable.is_zero());

    Ok(())
}

async fn create_account(
    sandbox: &near_sandbox::Sandbox,
    name: &str,
) -> testresult::TestResult<near_api::Account> {
    let account_id: AccountId = name.parse()?;
    sandbox
        .create_account(account_id.as_str().parse()?)
        .initial_balance(NearToken::from_near(10))
        .send()
        .await?;
    Ok(near_api::Account(account_id))
}
