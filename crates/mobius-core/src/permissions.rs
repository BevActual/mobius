//! The permission policy. Pure: it decides from the grants it is given and touches no storage.
use std::collections::HashSet;

use crate::model::{Capability, Duration, Effect, Grant, Principal, PrincipalKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// Allowed. When `consume` is set, that one-time grant is used up by this call.
    Allow { consume: Option<u64> },
    Deny,
    /// No grant covers this: someone has to decide.
    Ask,
    /// The person set this app to always ask: the person decides, each time (allow once), and no reviewer does.
    AskPerson,
}

/// The person's choice of how the assistant is gated, named as Hermes names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ApprovalMode {
    /// Ask the first time and remember if told to. The floors are asked about every time.
    #[default]
    Manual,
    /// Mobius makes reversible changes in the workspace (and reads it) without asking: what a turn changed waits as a
    /// proposal to keep, discard or try another way, since each turn begins with a checkpoint. Everything else is asked
    /// about as in manual, and the floors every time.
    Propose,
    /// Like manual, but a reviewer model first looks at each question: it can approve that one use, or point out
    /// that it looks dangerous. When it is unsure, or cannot answer, the person is asked.
    Smart,
    /// From before the three modes: ask about nothing but the floors, which are asked about in every mode. A
    /// standing block the person set still blocks.
    Off,
}

impl ApprovalMode {
    #[must_use]
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "manual" => Some(Self::Manual),
            "propose" => Some(Self::Propose),
            "smart" => Some(Self::Smart),
            "off" => Some(Self::Off),
            _ => None,
        }
    }

    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Propose => "propose",
            Self::Smart => "smart",
            Self::Off => "off",
        }
    }
}

/// A standing rule the person set in Settings (how much Mobius may do in each app), as opposed to a grant given while
/// answering a question. A rule's allow covers only the agent (not plugins or servers) and never a floor capability:
/// those are still asked about each time. A rule's deny covers everyone but the person. A rule's ask (the app set to
/// always ask) makes the agent ask the person every time, whatever the mode and any standing allow.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    pub capability: Capability,
    /// A resource pattern, as for grants (`notes/*`); none covers every resource.
    #[serde(default)]
    pub resource: Option<String>,
    pub effect: RuleEffect,
}

/// What a rule from Settings does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleEffect {
    Allow,
    Deny,
    Ask,
}

impl From<Effect> for RuleEffect {
    fn from(effect: Effect) -> Self {
        match effect {
            Effect::Allow => RuleEffect::Allow,
            Effect::Deny => RuleEffect::Deny,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Policy {
    floors: HashSet<String>,
    mode: ApprovalMode,
    rules: Vec<Rule>,
}

impl Policy {
    pub fn new<I: IntoIterator<Item = &'static str>>(floors: I) -> Self {
        Policy { floors: floors.into_iter().map(str::to_owned).collect(), mode: ApprovalMode::Manual, rules: Vec::new() }
    }

    /// Capabilities that can never be allowed standing: each use needs its own approval.
    pub fn default_floors() -> Self {
        Policy::new(["process.exec", "fs.delete", "secrets.read", "browser.interact"])
    }

    #[must_use]
    pub fn mode(&self) -> ApprovalMode {
        self.mode
    }

    pub fn set_mode(&mut self, mode: ApprovalMode) {
        self.mode = mode;
    }

    /// Replace the rules from Settings.
    pub fn set_rules(&mut self, rules: Vec<Rule>) {
        self.rules = rules;
    }

    #[must_use]
    pub fn rules(&self) -> &[Rule] {
        &self.rules
    }

    pub fn is_floor(&self, capability: &Capability) -> bool {
        self.floors.contains(capability.as_str())
    }

    /// Decide whether `principal` may use `capability` on `resource`.
    ///
    /// Order of precedence: a person is always allowed; any matching deny grant wins, then a deny rule from Settings;
    /// a standing allow (session or always) comes next, except for floor capabilities, which accept only one-time
    /// grants; then an allow rule from Settings (never for a floor); otherwise the approval mode decides.
    pub fn evaluate(
        &self,
        grants: &[Grant],
        now_ms: u64,
        principal: &Principal,
        capability: &Capability,
        resource: Option<&str>,
    ) -> Verdict {
        self.evaluate_in(grants, now_ms, principal, capability, resource, &[])
    }

    /// As `evaluate`, with a project's own rules counted beside the person's rules from Settings: a deny in either
    /// denies, an ask in either asks the person, an allow in either allows (never for a floor).
    pub fn evaluate_in(
        &self,
        grants: &[Grant],
        now_ms: u64,
        principal: &Principal,
        capability: &Capability,
        resource: Option<&str>,
        project: &[Rule],
    ) -> Verdict {
        if principal.kind == PrincipalKind::Person {
            return Verdict::Allow { consume: None };
        }
        let floor = self.is_floor(capability);
        let rule = |effect: RuleEffect| self.rules.iter().chain(project).any(|r| r.effect == effect && r.capability == *capability && resource_matches(r.resource.as_deref(), resource));
        let denied_by_rule = rule(RuleEffect::Deny);
        let always_ask = principal.kind == PrincipalKind::Agent && rule(RuleEffect::Ask);
        let mut standing = false;
        let mut once: Option<u64> = None;
        for grant in grants {
            if grant.principal != *principal || grant.capability != *capability {
                continue;
            }
            if grant.expires_ms.is_some_and(|expires| now_ms >= expires) {
                continue;
            }
            if !resource_matches(grant.resource.as_deref(), resource) {
                continue;
            }
            match (grant.effect, grant.duration) {
                (Effect::Deny, _) => return Verdict::Deny,
                (Effect::Allow, Duration::Once) => {
                    once.get_or_insert(grant.id);
                }
                (Effect::Allow, Duration::Session | Duration::Always) => standing |= !floor,
            }
        }
        if denied_by_rule {
            Verdict::Deny
        } else if always_ask {
            // Only an answer for this one use counts: no standing allow, rule or mode lets it through.
            once.map_or(Verdict::AskPerson, |id| Verdict::Allow { consume: Some(id) })
        } else if standing {
            Verdict::Allow { consume: None }
        } else if let Some(id) = once {
            Verdict::Allow { consume: Some(id) }
        } else if !floor && principal.kind == PrincipalKind::Agent && rule(RuleEffect::Allow) {
            Verdict::Allow { consume: None }
        } else if self.mode == ApprovalMode::Propose && !floor && principal.kind == PrincipalKind::Agent && is_reversible(capability) {
            // A proposal: the turn's checkpoint puts it back if the person discards it.
            Verdict::Allow { consume: None }
        } else if self.mode == ApprovalMode::Off && !floor {
            // Nothing but the floors is asked about, and no standing block matched.
            Verdict::Allow { consume: None }
        } else {
            Verdict::Ask
        }
    }
}

/// What Propose lets the agent do without asking: read the workspace and change it in ways a turn's checkpoint puts
/// back. Deleting files is a floor, and sending, browsing, mail and running commands are not here, so they still ask.
const REVERSIBLE: [&str; 12] = [
    "files.read", "files.write", "tasks.read", "tasks.write", "sheets.read", "sheets.write", "db.read", "db.write",
    "calendar.read", "calendar.write", "skills.read", "document.write",
];

#[must_use]
pub fn is_reversible(capability: &Capability) -> bool {
    REVERSIBLE.contains(&capability.as_str())
}

/// `None` matches every resource. A pattern ending in `*` matches by prefix (write patterns as `https://host/*`,
/// because `https://host*` would also match `https://host.evil.example`). Any other pattern must match exactly.
/// A pattern never matches a call that has no resource.
pub fn resource_matches(pattern: Option<&str>, resource: Option<&str>) -> bool {
    match (pattern, resource) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(pattern), Some(resource)) => match pattern.strip_suffix('*') {
            Some(prefix) => resource.starts_with(prefix),
            None => pattern == resource,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Duration, Effect};

    fn agent(id: &str) -> Principal {
        Principal::new(PrincipalKind::Agent, id).unwrap()
    }
    fn cap(name: &str) -> Capability {
        Capability::new(name).unwrap()
    }
    fn grant(id: u64, p: &Principal, c: &str, resource: Option<&str>, effect: Effect, duration: Duration) -> Grant {
        Grant {
            id,
            principal: p.clone(),
            capability: cap(c),
            resource: resource.map(str::to_owned),
            effect,
            duration,
            created_ms: 1_000,
            expires_ms: if duration == Duration::Once { Some(1_000 + 60_000) } else { None },
        }
    }
    fn policy() -> Policy {
        Policy::default_floors()
    }
    const NOW: u64 = 2_000;

    #[test]
    fn a_person_is_never_gated() {
        let person = Principal::new(PrincipalKind::Person, "me").unwrap();
        assert_eq!(policy().evaluate(&[], NOW, &person, &cap("document.write"), None), Verdict::Allow { consume: None });
        let denied = grant(1, &person, "document.write", None, Effect::Deny, Duration::Always);
        assert_eq!(policy().evaluate(&[denied], NOW, &person, &cap("document.write"), None), Verdict::Allow { consume: None });
    }

    #[test]
    fn without_a_grant_everyone_else_is_asked() {
        for kind in [PrincipalKind::Agent, PrincipalKind::McpServer, PrincipalKind::Plugin] {
            let p = Principal::new(kind, "x").unwrap();
            assert_eq!(policy().evaluate(&[], NOW, &p, &cap("browser.read"), None), Verdict::Ask, "{kind:?}");
        }
    }

    #[test]
    fn a_grant_covers_only_its_principal_and_capability() {
        let a = agent("a");
        let g = [grant(1, &a, "browser.read", None, Effect::Allow, Duration::Always)];
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("browser.read"), None), Verdict::Allow { consume: None });
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("browser.write"), None), Verdict::Ask);
        assert_eq!(policy().evaluate(&g, NOW, &agent("b"), &cap("browser.read"), None), Verdict::Ask);
        let same_id_other_kind = Principal::new(PrincipalKind::McpServer, "a").unwrap();
        assert_eq!(policy().evaluate(&g, NOW, &same_id_other_kind, &cap("browser.read"), None), Verdict::Ask);
    }

    fn rule(c: &str, resource: Option<&str>, effect: Effect) -> Rule {
        Rule { capability: cap(c), resource: resource.map(str::to_owned), effect: effect.into() }
    }

    #[test]
    fn a_projects_rules_count_only_in_that_project_and_never_open_a_floor() {
        let a = agent("a");
        let mut p = policy();
        p.set_rules(vec![rule("tasks.write", None, Effect::Deny)]);
        let act = [rule("files.write", Some("docs/*"), Effect::Allow), rule("tasks.write", None, Effect::Allow), rule("process.exec", None, Effect::Allow)];
        let ask = [Rule { capability: cap("files.write"), resource: Some("docs/*".into()), effect: RuleEffect::Ask }];
        // Act in the project: its app's changes go ahead there, and only there.
        assert_eq!(p.evaluate_in(&[], NOW, &a, &cap("files.write"), Some("docs/Plan.md"), &act), Verdict::Allow { consume: None });
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("files.write"), Some("docs/Plan.md")), Verdict::Ask);
        // What the person blocked in Settings stays blocked in every project.
        assert_eq!(p.evaluate_in(&[], NOW, &a, &cap("tasks.write"), None, &act), Verdict::Deny);
        // Commands, deleting and the other floors ask every time, whatever the project says.
        assert_eq!(p.evaluate_in(&[], NOW, &a, &cap("process.exec"), None, &act), Verdict::Ask);
        // Ask first in the project: the person, every time.
        assert_eq!(p.evaluate_in(&[], NOW, &a, &cap("files.write"), Some("docs/Plan.md"), &ask), Verdict::AskPerson);
    }

    #[test]
    fn rules_from_settings_allow_the_agent_deny_everyone_and_never_open_a_floor() {
        let a = agent("a");
        let mut p = policy();
        p.set_rules(vec![
            rule("tasks.write", None, Effect::Allow),
            rule("files.write", Some("notes/*"), Effect::Allow),
            rule("browser.navigate", None, Effect::Deny),
            rule("browser.interact", None, Effect::Allow),
        ]);
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("tasks.write"), Some("Inbox")), Verdict::Allow { consume: None });
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("files.write"), Some("notes/Plan.md")), Verdict::Allow { consume: None });
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("files.write"), Some("drafts/x.md")), Verdict::Ask, "only under notes/");
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("browser.interact"), None), Verdict::Ask, "a floor is still asked");
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("browser.navigate"), Some("https://a.example")), Verdict::Deny);
        let server = Principal::new(PrincipalKind::McpServer, "s").unwrap();
        assert_eq!(p.evaluate(&[], NOW, &server, &cap("tasks.write"), None), Verdict::Ask, "an allow rule is for the agent only");
        assert_eq!(p.evaluate(&[], NOW, &server, &cap("browser.navigate"), None), Verdict::Deny);
        // A standing allow the person gave still loses to a deny rule; even with approvals off the rule blocks.
        let g = [grant(1, &a, "browser.navigate", None, Effect::Allow, Duration::Always)];
        p.set_mode(ApprovalMode::Off);
        assert_eq!(p.evaluate(&g, NOW, &a, &cap("browser.navigate"), None), Verdict::Deny);
    }

    #[test]
    fn deny_beats_allow() {
        let a = agent("a");
        let g = [
            grant(1, &a, "browser.read", None, Effect::Allow, Duration::Always),
            grant(2, &a, "browser.read", Some("https://bank.example/*"), Effect::Deny, Duration::Always),
        ];
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("browser.read"), Some("https://bank.example/login")), Verdict::Deny);
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("browser.read"), Some("https://news.example/")), Verdict::Allow { consume: None });
    }

    #[test]
    fn resource_patterns() {
        assert!(resource_matches(None, None));
        assert!(resource_matches(None, Some("anything")));
        assert!(resource_matches(Some("https://a.example/x"), Some("https://a.example/x")));
        assert!(!resource_matches(Some("https://a.example/x"), Some("https://a.example/xy")));
        assert!(resource_matches(Some("https://a.example/*"), Some("https://a.example/deep/path")));
        assert!(!resource_matches(Some("https://a.example/*"), Some("https://evil.example/https://a.example/")));
        assert!(!resource_matches(Some("https://a.example/*"), None), "a pattern needs a resource to match");
        assert!(!resource_matches(Some("*"), None));
        assert!(resource_matches(Some("*"), Some("x")));
        assert!(!resource_matches(Some("a*b"), Some("aXb")), "only a trailing star is a wildcard");
        assert!(resource_matches(Some("a*b"), Some("a*b")));
    }

    #[test]
    fn a_resource_scoped_grant_does_not_cover_other_resources() {
        let a = agent("a");
        let g = [grant(1, &a, "browser.read", Some("https://a.example/*"), Effect::Allow, Duration::Always)];
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("browser.read"), Some("https://a.example/p")), Verdict::Allow { consume: None });
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("browser.read"), Some("https://b.example/p")), Verdict::Ask);
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("browser.read"), None), Verdict::Ask);
    }

    #[test]
    fn floors_never_accept_standing_grants() {
        let a = agent("a");
        for duration in [Duration::Always, Duration::Session] {
            let g = [grant(1, &a, "process.exec", None, Effect::Allow, duration)];
            assert_eq!(policy().evaluate(&g, NOW, &a, &cap("process.exec"), None), Verdict::Ask, "{duration:?}");
        }
    }

    #[test]
    fn acting_inside_a_web_page_is_a_floor_but_reading_and_opening_are_not() {
        let a = agent("a");
        let g = [grant(1, &a, "browser.interact", None, Effect::Allow, Duration::Always), grant(2, &a, "browser.read", None, Effect::Allow, Duration::Always)];
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("browser.interact"), None), Verdict::Ask, "clicking and typing are asked about every time");
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("browser.read"), None), Verdict::Allow { consume: None });
        let once = [grant(3, &a, "browser.interact", None, Effect::Allow, Duration::Once)];
        assert_eq!(policy().evaluate(&once, NOW, &a, &cap("browser.interact"), None), Verdict::Allow { consume: Some(3) });
    }

    #[test]
    fn floors_accept_a_one_time_grant_and_report_it_for_consumption() {
        let a = agent("a");
        let g = [grant(7, &a, "process.exec", None, Effect::Allow, Duration::Once)];
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("process.exec"), None), Verdict::Allow { consume: Some(7) });
    }

    #[test]
    fn a_deny_on_a_floor_still_denies() {
        let a = agent("a");
        let g = [grant(1, &a, "process.exec", None, Effect::Deny, Duration::Always)];
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("process.exec"), None), Verdict::Deny);
    }

    #[test]
    fn a_standing_grant_is_used_before_a_one_time_grant() {
        let a = agent("a");
        let g = [
            grant(1, &a, "browser.read", None, Effect::Allow, Duration::Once),
            grant(2, &a, "browser.read", None, Effect::Allow, Duration::Always),
        ];
        assert_eq!(policy().evaluate(&g, NOW, &a, &cap("browser.read"), None), Verdict::Allow { consume: None });
    }

    #[test]
    fn expired_one_time_grants_are_ignored() {
        let a = agent("a");
        let g = [grant(1, &a, "browser.read", None, Effect::Allow, Duration::Once)];
        assert_eq!(policy().evaluate(&g, 1_000 + 60_000, &a, &cap("browser.read"), None), Verdict::Ask, "expires_ms is exclusive");
        assert_eq!(policy().evaluate(&g, 1_000 + 59_999, &a, &cap("browser.read"), None), Verdict::Allow { consume: Some(1) });
    }

    #[test]
    fn an_app_set_to_always_ask_asks_the_person_every_time_in_every_mode() {
        let a = agent("mobius");
        let always = Rule { capability: cap("files.write"), resource: Some("notes/*".into()), effect: RuleEffect::Ask };
        let standing = grant(1, &a, "files.write", Some("notes/*"), Effect::Allow, Duration::Always);
        for mode in [ApprovalMode::Manual, ApprovalMode::Propose, ApprovalMode::Smart, ApprovalMode::Off] {
            let mut p = policy();
            p.set_mode(mode);
            p.set_rules(vec![always.clone()]);
            assert_eq!(p.evaluate(&[standing.clone()], NOW, &a, &cap("files.write"), Some("notes/Plan.md")), Verdict::AskPerson, "{mode:?}");
            // An answer for this one use lets it through, once.
            let once = grant(2, &a, "files.write", Some("notes/Plan.md"), Effect::Allow, Duration::Once);
            assert_eq!(p.evaluate(&[once], NOW, &a, &cap("files.write"), Some("notes/Plan.md")), Verdict::Allow { consume: Some(2) });
            // Other apps follow the mode as before.
            assert_ne!(p.evaluate(&[], NOW, &a, &cap("tasks.write"), None), Verdict::AskPerson);
        }
        let parsed: Rule = serde_json::from_value(serde_json::json!({ "capability": "files.write", "resource": "notes/*", "effect": "ask" })).unwrap();
        assert_eq!(parsed, always);
    }

    #[test]
    fn propose_lets_the_agent_change_the_workspace_and_asks_about_the_rest() {
        let mut p = policy();
        p.set_mode(ApprovalMode::Propose);
        let a = agent("mobius");
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("files.write"), Some("notes/Plan.md")), Verdict::Allow { consume: None });
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("tasks.write"), None), Verdict::Allow { consume: None });
        // Not reversible, or a floor: asked as in manual.
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("browser.navigate"), None), Verdict::Ask);
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("mail.read"), None), Verdict::Ask);
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("fs.delete"), Some("notes/Plan.md")), Verdict::Ask);
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("process.exec"), None), Verdict::Ask);
        // A block still blocks, and only the agent gets the leeway.
        let deny = grant(1, &a, "files.write", Some("notes/*"), Effect::Deny, Duration::Always);
        assert_eq!(p.evaluate(&[deny], NOW, &a, &cap("files.write"), Some("notes/Plan.md")), Verdict::Deny);
        let plugin = Principal::new(PrincipalKind::Plugin, "x").unwrap();
        assert_eq!(p.evaluate(&[], NOW, &plugin, &cap("files.write"), Some("notes/Plan.md")), Verdict::Ask);
        assert_eq!(ApprovalMode::parse("propose"), Some(ApprovalMode::Propose));
        assert_eq!(ApprovalMode::Propose.as_str(), "propose");
    }

    #[test]
    fn capability_names_are_validated() {
        for ok in ["browser.read", "document.write", "a.b", "net.http_get", "x1.y2.z3"] {
            assert!(Capability::new(ok).is_ok(), "{ok}");
        }
        for bad in ["", "read", ".read", "browser.", "Browser.read", "browser..read", "browser.re ad", "browser.read\n", "1a.b", &"a.".repeat(40)] {
            assert!(Capability::new(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn principal_ids_are_validated() {
        assert!(Principal::new(PrincipalKind::Agent, "claude-code").is_ok());
        assert!(Principal::new(PrincipalKind::Agent, "").is_err());
        assert!(Principal::new(PrincipalKind::Agent, "a\nb").is_err());
        assert!(Principal::new(PrincipalKind::Agent, &"a".repeat(129)).is_err());
    }

    // ---- approval mode (as Hermes names it: manual, or off) ---------------------------------------------------

    fn in_mode(mode: ApprovalMode) -> Policy {
        let mut p = Policy::default_floors();
        p.set_mode(mode);
        p
    }

    #[test]
    fn manual_is_the_default_and_is_what_there_was_before() {
        assert_eq!(Policy::default_floors().mode(), ApprovalMode::Manual);
        let a = agent("a");
        let always = grant(1, &a, "browser.navigate", Some("https://x.example"), Effect::Allow, Duration::Always);
        assert_eq!(in_mode(ApprovalMode::Manual).evaluate(&[always], NOW, &a, &cap("browser.navigate"), Some("https://x.example")), Verdict::Allow { consume: None });
        assert_eq!(in_mode(ApprovalMode::Manual).evaluate(&[], NOW, &a, &cap("browser.read"), None), Verdict::Ask);
        assert_eq!(in_mode(ApprovalMode::Manual).evaluate(&[], NOW, &a, &cap("browser.interact"), None), Verdict::Ask);
    }

    #[test]
    fn with_approvals_off_nothing_is_asked_about_but_the_floors() {
        let p = in_mode(ApprovalMode::Off);
        let a = agent("a");
        for name in ["browser.read", "browser.navigate", "demo.anything"] {
            assert_eq!(p.evaluate(&[], NOW, &a, &cap(name), None), Verdict::Allow { consume: None }, "{name}");
        }
        // Running commands, deleting, secrets and clicking or typing in a page ask in every mode, Off too.
        for name in ["browser.interact", "process.exec", "fs.delete", "secrets.read"] {
            assert_eq!(p.evaluate(&[], NOW, &a, &cap(name), None), Verdict::Ask, "{name}");
        }
    }

    #[test]
    fn with_approvals_off_a_block_the_person_set_still_blocks() {
        let p = in_mode(ApprovalMode::Off);
        let a = agent("a");
        let deny = grant(1, &a, "process.exec", None, Effect::Deny, Duration::Always);
        assert_eq!(p.evaluate(&[deny], NOW, &a, &cap("process.exec"), None), Verdict::Deny);
        let site = grant(2, &a, "browser.navigate", Some("https://bad.example"), Effect::Deny, Duration::Always);
        assert_eq!(p.evaluate(std::slice::from_ref(&site), NOW, &a, &cap("browser.navigate"), Some("https://bad.example")), Verdict::Deny);
        assert_eq!(p.evaluate(&[site], NOW, &a, &cap("browser.navigate"), Some("https://good.example")), Verdict::Allow { consume: None });
    }

    #[test]
    fn a_person_is_never_gated_in_either_mode() {
        let person = Principal::new(PrincipalKind::Person, "me").unwrap();
        for mode in [ApprovalMode::Manual, ApprovalMode::Smart, ApprovalMode::Off] {
            assert_eq!(in_mode(mode).evaluate(&[], NOW, &person, &cap("process.exec"), None), Verdict::Allow { consume: None });
        }
    }

    #[test]
    fn the_floors_are_the_same_list_in_both_modes() {
        for mode in [ApprovalMode::Manual, ApprovalMode::Smart, ApprovalMode::Off] {
            let p = in_mode(mode);
            for floor in ["process.exec", "fs.delete", "secrets.read", "browser.interact"] {
                assert!(p.is_floor(&cap(floor)), "{floor}");
            }
            assert!(!p.is_floor(&cap("browser.read")));
        }
    }

    #[test]
    fn modes_have_the_names_hermes_uses() {
        assert_eq!(ApprovalMode::parse("manual"), Some(ApprovalMode::Manual));
        assert_eq!(ApprovalMode::parse("off"), Some(ApprovalMode::Off));
        assert_eq!(ApprovalMode::parse("smart"), Some(ApprovalMode::Smart));
        assert_eq!(ApprovalMode::Smart.as_str(), "smart");
        for bad in ["", "auto", "yolo", "Manual", "Smart", "careful", "standard", "relaxed", "none", "all"] {
            assert_eq!(ApprovalMode::parse(bad), None, "{bad}");
        }
        assert_eq!(ApprovalMode::Off.as_str(), "off");
        assert_eq!(ApprovalMode::Manual.as_str(), "manual");
    }

    #[test]
    fn smart_asks_in_the_policy_like_manual_and_leaves_the_review_to_the_agent() {
        let p = in_mode(ApprovalMode::Smart);
        let a = agent("a");
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("browser.read"), None), Verdict::Ask);
        assert_eq!(p.evaluate(&[], NOW, &a, &cap("process.exec"), None), Verdict::Ask);
        let always = grant(1, &a, "browser.read", None, Effect::Allow, Duration::Always);
        assert_eq!(p.evaluate(&[always], NOW, &a, &cap("browser.read"), None), Verdict::Allow { consume: None });
        let deny = grant(2, &a, "process.exec", None, Effect::Deny, Duration::Always);
        assert_eq!(p.evaluate(&[deny], NOW, &a, &cap("process.exec"), None), Verdict::Deny);
        assert!(p.is_floor(&cap("process.exec")));
    }
}
