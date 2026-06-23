//! Pricing table and per-model cost computation.
//!
//! The default table is the repo-root `pricing.json`, embedded at compile time so
//! the release binary needs no external file. A caller may load an override path.

use crate::error::Result;
use crate::model::{ProviderId, Usage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

const DEFAULT_PRICING: &str = include_str!("../../../pricing.json");

/// Per-million-token rates for one model or tier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rate {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_create_5m: f64,
    pub cache_create_1h: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelRate {
    #[serde(default)]
    pub tier: Option<String>,
    #[serde(flatten)]
    pub rate: Rate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plan {
    pub monthly: f64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pricing {
    pub models: HashMap<String, ModelRate>,
    pub tier_fallback: HashMap<String, Rate>,
    pub plans: HashMap<String, Plan>,
}

/// Result of costing a usage tally against a model.
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct Cost {
    pub usd: Option<f64>,
    pub estimated: bool,
}

const TIERS: [&str; 4] = ["fable", "opus", "sonnet", "haiku"];

impl Pricing {
    pub fn load_default() -> Self {
        serde_json::from_str(DEFAULT_PRICING).expect("embedded pricing.json must be valid")
    }

    pub fn load_from(path: &Path) -> Result<Self> {
        Ok(serde_json::from_str(&std::fs::read_to_string(path)?)?)
    }

    fn tier_of(model: &str) -> Option<&'static str> {
        TIERS.into_iter().find(|t| model.contains(t))
    }

    fn cost_for_model_key(
        &self,
        model: Option<&str>,
        u: &Usage,
        allow_tier: bool,
        cached_input_is_subset: bool,
    ) -> Cost {
        let Some(model) = model else {
            return Cost {
                usd: None,
                estimated: false,
            };
        };
        let (rate, estimated) = if let Some(mr) = self.models.get(model) {
            (&mr.rate, false)
        } else if allow_tier {
            let Some(t) = Self::tier_of(model) else {
                return Cost {
                    usd: None,
                    estimated: false,
                };
            };
            match self.tier_fallback.get(t) {
                Some(r) => (r, true),
                None => {
                    return Cost {
                        usd: None,
                        estimated: true,
                    }
                }
            }
        } else {
            return Cost {
                usd: None,
                estimated: false,
            };
        };

        let full_price_input = if cached_input_is_subset {
            (u.input_tokens - u.cache_read_tokens).max(0)
        } else {
            u.input_tokens
        };
        let usd = (full_price_input as f64 * rate.input
            + u.output_tokens as f64 * rate.output
            + u.cache_read_tokens as f64 * rate.cache_read
            + u.cache_create_5m_tokens as f64 * rate.cache_create_5m
            + u.cache_create_1h_tokens as f64 * rate.cache_create_1h)
            / 1_000_000.0;
        Cost {
            usd: Some(usd),
            estimated,
        }
    }

    /// Cost for a usage tally under `model`. Unknown model → tier fallback (estimated);
    /// no tier match or no model → `usd: None`.
    pub fn cost_for(&self, model: Option<&str>, u: &Usage) -> Cost {
        self.cost_for_provider(ProviderId::Claude, model, u)
    }

    /// Provider-aware lookup. Qualified model keys (`codex:gpt-5.5`) are exact;
    /// Claude keeps the historical unqualified lookup and tier fallback.
    pub fn cost_for_provider(&self, provider: ProviderId, model: Option<&str>, u: &Usage) -> Cost {
        let Some(model) = model else {
            return Cost {
                usd: None,
                estimated: false,
            };
        };
        let qualified = format!("{}:{model}", provider.as_str());
        let cached_input_is_subset = provider == ProviderId::Codex;
        let exact = self.cost_for_model_key(Some(&qualified), u, false, cached_input_is_subset);
        if exact.usd.is_some() {
            return exact;
        }
        if provider == ProviderId::Claude {
            self.cost_for_model_key(Some(model), u, true, false)
        } else {
            self.cost_for_model_key(Some(model), u, false, cached_input_is_subset)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_pricing_loads() {
        let p = Pricing::load_default();
        assert!(p.models.contains_key("claude-opus-4-8"));
        assert!(p.plans.contains_key("pro"));
    }

    #[test]
    fn known_model_cost_is_exact() {
        let p = Pricing::load_default();
        let u = Usage {
            input_tokens: 1_000_000,
            ..Default::default()
        };
        let c = p.cost_for(Some("claude-opus-4-8"), &u);
        assert!(!c.estimated);
        assert!((c.usd.unwrap() - 5.0).abs() < 1e-9);
    }

    #[test]
    fn unknown_opus_variant_falls_back_estimated() {
        let p = Pricing::load_default();
        let u = Usage {
            output_tokens: 1_000_000,
            ..Default::default()
        };
        let c = p.cost_for(Some("claude-opus-9-9-experimental"), &u);
        assert!(c.estimated);
        assert!((c.usd.unwrap() - 75.0).abs() < 1e-9);
    }

    #[test]
    fn unknown_tier_yields_no_cost() {
        let p = Pricing::load_default();
        let c = p.cost_for(Some("some-other-llm"), &Usage::default());
        assert!(c.usd.is_none());
    }

    #[test]
    fn codex_cached_input_is_priced_as_input_subset() {
        let p = Pricing::load_default();
        let u = Usage {
            input_tokens: 1_000_000,
            cache_read_tokens: 900_000,
            ..Default::default()
        };
        let c = p.cost_for_provider(ProviderId::Codex, Some("gpt-5.5"), &u);
        assert!(!c.estimated);
        assert!((c.usd.unwrap() - 0.95).abs() < 1e-9);
    }
}
