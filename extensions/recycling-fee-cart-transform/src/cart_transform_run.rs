use super::schema;
use serde::Deserialize;
use shopify_function::prelude::*;
use shopify_function::Result;
use std::collections::{HashMap, HashSet};

type CartLine = schema::cart_transform_run::input::cart::Lines;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RecyclingFeeConfiguration {
    enabled: Option<bool>,
    #[serde(default)]
    mattress_product_types: Vec<String>,
    fee_variant_id: Option<String>,
    #[serde(default)]
    rates: HashMap<String, RecyclingFeeRateValue>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum RecyclingFeeRateValue {
    Amount(f64),
    Object(RecyclingFeeRateObject),
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RecyclingFeeRateObject {
    #[serde(default)]
    rate: f64,
    sku: Option<String>,
    variant_id: Option<String>,
}

#[derive(Debug, PartialEq)]
struct ResolvedRecyclingFee {
    province: String,
    sku: String,
    variant_id: String,
    mattress_qty: i32,
    total_fee: f64,
}

/// Cart line fields the fee logic needs, decoupled from the generated input types.
struct FeeLine {
    id: String,
    quantity: i32,
    total_amount: f64,
    variant_id: Option<String>,
    product_type: Option<String>,
    fee_flag: bool,
}

#[derive(Debug, PartialEq)]
struct FeeExpandPlan {
    host_line_id: String,
    host_variant_id: String,
    host_unit_price: f64,
    fee_variant_id: String,
    component_quantity: i32,
    unit_price: f64,
}

#[shopify_function]
fn cart_transform_run(
    input: schema::cart_transform_run::Input,
) -> Result<schema::CartTransformRunResult> {
    let config = parse_recycling_fee_configuration(
        input
            .shop()
            .recycling_fee()
            .as_ref()
            .map(|field| field.value().as_str()),
    );
    let lines: Vec<FeeLine> = input.cart().lines().iter().map(fee_line).collect();
    let province = recycling_fee_province(input.cart());

    let operations = resolve_recycling_fee(&config, &lines, province.as_deref())
        .and_then(|fee| plan_recycling_fee_expand(&config, &lines, &fee).map(|plan| (fee, plan)))
        .map(|(fee, plan)| vec![schema::Operation::LineExpand(expand_operation(&fee, &plan))])
        .unwrap_or_default();

    Ok(schema::CartTransformRunResult { operations })
}

fn fee_line(line: &CartLine) -> FeeLine {
    let variant = match line.merchandise() {
        schema::cart_transform_run::input::cart::lines::Merchandise::ProductVariant(variant) => {
            Some(variant)
        }
        _ => None,
    };
    FeeLine {
        id: line.id().clone(),
        quantity: *line.quantity(),
        total_amount: line.cost().total_amount().amount().0,
        variant_id: variant.map(|variant| variant.id().clone()),
        product_type: variant.and_then(|variant| variant.product().product_type().cloned()),
        fee_flag: line
            .recycling_fee()
            .as_ref()
            .and_then(|attribute| attribute.value())
            .map(|value| value.trim() == "true")
            .unwrap_or(false),
    }
}

fn parse_recycling_fee_configuration(value: Option<&str>) -> RecyclingFeeConfiguration {
    value
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default()
}

fn recycling_fee_province(cart: &schema::cart_transform_run::input::Cart) -> Option<String> {
    pick_recycling_fee_province(
        cart.recycling_fee_province()
            .as_ref()
            .and_then(|attribute| attribute.value())
            .map(|value| value.as_str()),
        cart.billing_address()
            .and_then(|address| address.province_code())
            .map(|value| value.as_str()),
    )
}

/// The checkout extension writes the shipping state into a cart attribute because
/// Cart Transform input has no shipping address; billing state is the fallback.
fn pick_recycling_fee_province(
    shipping_province: Option<&str>,
    billing_province: Option<&str>,
) -> Option<String> {
    shipping_province
        .map(normalize_state_code)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            billing_province
                .map(normalize_state_code)
                .filter(|value| !value.is_empty())
        })
}

fn resolve_recycling_fee(
    config: &RecyclingFeeConfiguration,
    lines: &[FeeLine],
    province: Option<&str>,
) -> Option<ResolvedRecyclingFee> {
    if config.enabled == Some(false) || config.rates.is_empty() {
        return None;
    }
    let province = province.filter(|value| !value.is_empty())?;
    let (rate, sku, variant_id) = recycling_fee_rate(config, province)?;
    if rate <= 0.0 || variant_id.is_empty() {
        return None;
    }
    let mattress_qty = total_mattress_quantity(lines, config);
    if mattress_qty <= 0 {
        return None;
    }
    Some(ResolvedRecyclingFee {
        province: province.to_string(),
        sku,
        variant_id,
        mattress_qty,
        total_fee: recycling_fee_total(rate, mattress_qty),
    })
}

fn recycling_fee_rate(
    config: &RecyclingFeeConfiguration,
    province: &str,
) -> Option<(f64, String, String)> {
    let raw = config.rates.get(province)?;
    let (rate, sku, variant_id) = match raw {
        RecyclingFeeRateValue::Amount(amount) => (*amount, None, config.fee_variant_id.clone()),
        RecyclingFeeRateValue::Object(object) => (
            object.rate,
            object.sku.clone(),
            object
                .variant_id
                .clone()
                .or_else(|| config.fee_variant_id.clone()),
        ),
    };
    Some((
        rate,
        normalize_recycling_fee_sku(sku.as_deref(), province),
        variant_id.filter(|value| !value.trim().is_empty())?,
    ))
}

fn recycling_fee_total(rate: f64, mattress_qty: i32) -> f64 {
    round_money(rate * mattress_qty.max(0) as f64)
}

fn round_money(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn normalize_state_code(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphabetic())
        .map(|character| character.to_ascii_uppercase())
        .take(2)
        .collect()
}

fn normalize_recycling_fee_sku(sku: Option<&str>, province: &str) -> String {
    let normalized = sku.unwrap_or("").trim().to_uppercase();
    if normalized.is_empty() {
        format!("SSMRF{province}")
    } else {
        normalized
    }
}

fn mattress_product_types(config: &RecyclingFeeConfiguration) -> HashSet<String> {
    config
        .mattress_product_types
        .iter()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .collect()
}

fn collect_fee_variant_ids(config: &RecyclingFeeConfiguration) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(variant_id) = config.fee_variant_id.as_deref() {
        if !variant_id.trim().is_empty() {
            ids.push(normalize_variant_gid(variant_id));
        }
    }
    for value in config.rates.values() {
        if let RecyclingFeeRateValue::Object(object) = value {
            if let Some(variant_id) = object.variant_id.as_deref() {
                if !variant_id.trim().is_empty() {
                    ids.push(normalize_variant_gid(variant_id));
                }
            }
        }
    }
    ids
}

fn is_recycling_fee_line(line: &FeeLine, fee_variant_ids: &[String]) -> bool {
    line.fee_flag
        || line
            .variant_id
            .as_deref()
            .map(|id| fee_variant_ids.iter().any(|fee_id| ids_match(fee_id, id)))
            .unwrap_or(false)
}

fn is_mattress_line(line: &FeeLine, types: &HashSet<String>, fee_variant_ids: &[String]) -> bool {
    !is_recycling_fee_line(line, fee_variant_ids)
        && line.quantity > 0
        && line.variant_id.is_some()
        && line
            .product_type
            .as_deref()
            .map(|product_type| types.contains(&product_type.trim().to_lowercase()))
            .unwrap_or(false)
}

fn total_mattress_quantity(lines: &[FeeLine], config: &RecyclingFeeConfiguration) -> i32 {
    let types = mattress_product_types(config);
    if types.is_empty() {
        return 0;
    }
    let fee_variant_ids = collect_fee_variant_ids(config);
    lines
        .iter()
        .filter(|line| is_mattress_line(line, &types, &fee_variant_ids))
        .map(|line| line.quantity)
        .sum()
}

/// Returns `None` when the cart already carries a fee line: the checkout extension
/// owns that line's quantity, so expanding here would charge the fee twice.
fn plan_recycling_fee_expand(
    config: &RecyclingFeeConfiguration,
    lines: &[FeeLine],
    fee: &ResolvedRecyclingFee,
) -> Option<FeeExpandPlan> {
    let fee_variant_ids = collect_fee_variant_ids(config);
    if lines
        .iter()
        .any(|line| is_recycling_fee_line(line, &fee_variant_ids))
    {
        return None;
    }

    let types = mattress_product_types(config);
    let host = recycling_fee_host_line(lines, &types, &fee_variant_ids, fee.mattress_qty)?;
    let host_quantity = host.quantity.max(1);
    let component_quantity = recycling_fee_component_quantity(fee.mattress_qty, host_quantity);
    let presented_quantity = component_quantity.saturating_mul(host_quantity);

    Some(FeeExpandPlan {
        host_line_id: host.id.clone(),
        host_variant_id: host.variant_id.clone()?,
        host_unit_price: round_money(host.total_amount.max(0.0) / host_quantity as f64),
        fee_variant_id: normalize_variant_gid(&fee.variant_id),
        component_quantity,
        unit_price: round_money(fee.total_fee / presented_quantity.max(1) as f64),
    })
}

/// Prefer a host whose quantity divides the mattress count, so the presented fee
/// quantity equals the mattress count and the unit price stays at the state rate.
fn recycling_fee_host_line<'a>(
    lines: &'a [FeeLine],
    types: &HashSet<String>,
    fee_variant_ids: &[String],
    mattress_qty: i32,
) -> Option<&'a FeeLine> {
    let mut candidates: Vec<&FeeLine> = lines
        .iter()
        .filter(|line| is_mattress_line(line, types, fee_variant_ids))
        .collect();
    candidates.sort_by_key(|line| {
        let quantity = line.quantity.max(1);
        let divides = mattress_qty.max(1) % quantity == 0;
        (!divides, quantity)
    });
    candidates.into_iter().next()
}

/// Expanded quantities are per parent unit and Shopify multiplies them by the
/// cart line quantity.
fn recycling_fee_component_quantity(mattress_qty: i32, host_quantity: i32) -> i32 {
    let host_quantity = host_quantity.max(1);
    let mattress_qty = mattress_qty.max(1);
    if mattress_qty % host_quantity == 0 {
        mattress_qty / host_quantity
    } else {
        1
    }
}

fn expand_operation(fee: &ResolvedRecyclingFee, plan: &FeeExpandPlan) -> schema::LineExpandOperation {
    let mut attributes = vec![
        attribute("_recycling_fee", "true".to_string()),
        attribute("_recycling_fee_province", fee.province.clone()),
        attribute("_recycling_fee_amount", format!("{:.2}", fee.total_fee)),
        attribute(
            "_recycling_fee_title",
            format!(
                "Mattress Recycling Fee ({}) × {}",
                fee.province, fee.mattress_qty
            ),
        ),
    ];
    if !fee.sku.is_empty() {
        attributes.push(attribute("_recycling_fee_sku", fee.sku.clone()));
    }

    schema::LineExpandOperation {
        cart_line_id: plan.host_line_id.clone(),
        expanded_cart_items: vec![
            // Shopify rejects an expand where only some items are priced.
            schema::ExpandedItem {
                attributes: Some(vec![]),
                merchandise_id: plan.host_variant_id.clone(),
                price: Some(fixed_price_per_unit(plan.host_unit_price)),
                quantity: 1,
            },
            schema::ExpandedItem {
                attributes: Some(attributes),
                merchandise_id: plan.fee_variant_id.clone(),
                price: Some(fixed_price_per_unit(plan.unit_price)),
                quantity: plan.component_quantity,
            },
        ],
        image: None,
        price: None,
        title: None,
    }
}

fn fixed_price_per_unit(amount: f64) -> schema::ExpandedItemPriceAdjustment {
    schema::ExpandedItemPriceAdjustment {
        adjustment: schema::ExpandedItemPriceAdjustmentValue::FixedPricePerUnit(
            schema::ExpandedItemFixedPricePerUnitAdjustment {
                amount: Decimal(amount),
            },
        ),
    }
}

fn attribute(key: &str, value: String) -> schema::AttributeOutput {
    schema::AttributeOutput {
        key: key.to_string(),
        value,
    }
}

fn ids_match(left: &str, right: &str) -> bool {
    left == right || left.split('/').last() == right.split('/').last()
}

fn normalize_variant_gid(variant_id: &str) -> String {
    if variant_id.starts_with("gid://") {
        variant_id.to_string()
    } else {
        format!("gid://shopify/ProductVariant/{variant_id}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONFIG: &str = r#"{"enabled":true,"mattressProductTypes":["Mattresses"],"rates":{"CA":{"rate":18,"sku":"SSMRFCA","variantId":"gid://shopify/ProductVariant/11"},"CT":{"rate":16,"sku":"SSMRFCT","variantId":"gid://shopify/ProductVariant/12"}}}"#;

    fn line(id: &str, quantity: i32, variant: &str, product_type: &str) -> FeeLine {
        FeeLine {
            id: format!("gid://shopify/CartLine/{id}"),
            quantity,
            total_amount: 449.0 * quantity as f64,
            variant_id: Some(format!("gid://shopify/ProductVariant/{variant}")),
            product_type: Some(product_type.to_string()),
            fee_flag: false,
        }
    }

    fn plan(lines: &[FeeLine], province: &str) -> Option<FeeExpandPlan> {
        let config = parse_recycling_fee_configuration(Some(CONFIG));
        let fee = resolve_recycling_fee(&config, lines, Some(province))?;
        plan_recycling_fee_expand(&config, lines, &fee)
    }

    #[test]
    fn prefers_shipping_province_over_billing() {
        assert_eq!(pick_recycling_fee_province(Some("CA"), Some("NY")).as_deref(), Some("CA"));
        assert_eq!(pick_recycling_fee_province(None, Some("ca")).as_deref(), Some("CA"));
        assert_eq!(pick_recycling_fee_province(Some(""), Some("CT")).as_deref(), Some("CT"));
        assert!(pick_recycling_fee_province(None, None).is_none());
    }

    #[test]
    fn one_mattress_gets_one_fee_at_state_rate() {
        let lines = [line("1", 1, "100", "Mattresses")];
        let plan = plan(&lines, "CA").unwrap();
        assert_eq!(plan.component_quantity, 1);
        assert_eq!(plan.unit_price, 18.0);
        assert_eq!(plan.host_unit_price, 449.0);
        assert_eq!(plan.fee_variant_id, "gid://shopify/ProductVariant/11");
    }

    #[test]
    fn fee_quantity_matches_mattress_count() {
        let two_on_one_line = [line("1", 2, "100", "Mattresses")];
        let plan_a = plan(&two_on_one_line, "CA").unwrap();
        assert_eq!(plan_a.component_quantity * 2, 2);
        assert_eq!(plan_a.unit_price, 18.0);
        assert_eq!(plan_a.host_unit_price, 449.0);

        let two_lines = [
            line("1", 1, "100", "Mattresses"),
            line("2", 1, "101", "Mattresses"),
        ];
        let plan_b = plan(&two_lines, "CA").unwrap();
        assert_eq!(plan_b.component_quantity, 2);
        assert_eq!(plan_b.unit_price, 18.0);
    }

    #[test]
    fn skips_when_fee_line_already_exists() {
        let mut fee = line("2", 1, "11", "Fee");
        fee.fee_flag = true;
        let lines = [line("1", 1, "100", "Mattresses"), fee];
        assert!(plan(&lines, "CA").is_none());
    }

    #[test]
    fn skips_unconfigured_state_and_non_mattress_products() {
        assert!(plan(&[line("1", 1, "100", "Mattresses")], "TX").is_none());
        assert!(plan(&[line("1", 1, "200", "Beds & Bed Frames")], "CA").is_none());
    }

    #[test]
    fn uses_state_specific_variant_and_rate() {
        let plan = plan(&[line("1", 1, "100", "Mattresses")], "CT").unwrap();
        assert_eq!(plan.fee_variant_id, "gid://shopify/ProductVariant/12");
        assert_eq!(plan.unit_price, 16.0);
    }

    #[test]
    fn disabled_config_charges_nothing() {
        let config = parse_recycling_fee_configuration(Some(
            r#"{"enabled":false,"mattressProductTypes":["Mattresses"],"rates":{"CA":{"rate":18,"variantId":"11"}}}"#,
        ));
        let lines = [line("1", 1, "100", "Mattresses")];
        assert!(resolve_recycling_fee(&config, &lines, Some("CA")).is_none());
    }
}
