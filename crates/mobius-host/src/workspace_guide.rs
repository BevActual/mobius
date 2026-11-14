//! What the agent is told each turn about where the person's apps keep things in the workspace and how their files
//! are written, so a page, board or song it makes opens in the right app. Short: it goes with every turn.

pub const GUIDE: &str = r#"Where apps keep things (workspace paths; folders made as needed):
- Notes: notes/<notebook>/<page>.md · Docs: docs/<folder>/<doc>.md · Slides: slides/<folder>/<deck>.md, slides split by ---; a slide's first line <!-- style: accent|dark|warm|light --> sets its look (accent to open, dark for section breaks).
- Research reports: research/<folder>/<report>.md · Reader articles: reading/<list>/<article>.md.
- Sheets, Tasks, Calendar, Mail, databases: their own tools (sheets.*, tasks.*, calendar.*, mail.*, db.*).
- Code projects: code/<project>/ · Skills: skills/<name>/SKILL.md.
- Design: designs/<folder>/<design>.json = {"version":1,"styles":[{"name","color"}],"frames":[{"id","name",x,y,w,h,fill,radius,stroke,strokeWidth,"component"?,"children":[{"id","type":"rect|ellipse|text|instance","name",x,y,w,h,fill,radius,stroke,strokeWidth,text,size,weight,color,hidden?,locked?,of,overrides}]}]}; colours #rrggbb or "style:<name>"; stroke = inner border; an instance copies the component frame "of", with overrides {<layer id>:{text,fill,color}}.
- Canvas boards: boards/<folder>/<board>.json = {"version":1,"items":[...]}, items: {"id":"s1","type":"sticky","x","y","w":180,"h":180,"color","text"}, {"type":"shape","shape":"rect|ellipse|diamond",x,y,w,h,color,text}, {"type":"text",x,y,w,h,text,"size"}, {"type":"arrow","from":<id>,"to":<id>,"text"}; colours yellow, orange, pink, green, blue, purple, grey, white.
- Views (dashboards): views/<folder>/<view>.json = {"version":1,"tiles":[{"id","kind":"mobius|tasks|calendar|mail|notes|next","size":"small|wide","title","show" (tasks: today|scheduled|flagged|all; calendar: today|week),"notebook"}]}; tiles show live data, never copy it.
- Music songs: studio/<folder>/<song>.json = {"version":1,"tempo","key","bars","tracks":[{"id","name","instrument":"piano|bass|pad|lead|drums","volume","notes":[{"pitch" (MIDI),"start","length" (beats),"velocity"}]}]}. Sound, kits, effects: skills.read app:music.
- Video: video/<project>/cut.json = {"version":1,"shots":[{"id","clip","in","out","title"}]}; never change the clips. Exported films: <project>/Exports/.
- Photo edits: photos/<album>/<photo>.edits.json = {"version":1,"adjustments":[{"id","name","exposure","highlights","shadows","contrast","saturation","warmth","tint","vignette" (each -100 to 100),"area":{"kind":"all|below|above|ellipse",...}}],"geometry" (optional):{"turns" (0-3),"flip","straighten" (-45 to 45),"crop":{"x","y","w","h"} (0 to 1)}}; that crops and straightens. Never change the pictures.
When changing one, keep the ids of what you leave alone; new things get new ids."#;

/// Longer guides to one app's files (`docs/agent/<app>.md`), read only when needed: `skills.read` with `app:<app>`.
pub const APP_GUIDES: [(&str, &str); 1] = [("music", include_str!("../../../docs/agent/music.md"))];

/// The guide `skills.read` asked for by `app:<name>`, if that is what it asked for.
#[must_use]
pub fn app_guide(name: &str) -> Option<&'static str> {
    let app = name.strip_prefix("app:")?;
    APP_GUIDES.iter().find(|(n, _)| *n == app).map(|(_, text)| *text)
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_guide_stays_short() {
        assert!(super::GUIDE.len() < 2600, "{}", super::GUIDE.len());
    }

    #[test]
    fn an_app_guide_is_read_by_its_reserved_name() {
        assert!(super::app_guide("app:music").is_some_and(|t| t.contains("studio/")));
        assert!(super::app_guide("music").is_none(), "a skill of that name is the person's own");
        assert!(super::app_guide("app:nope").is_none());
    }
}
