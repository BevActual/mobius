//! What the agent is told each turn about where the person's apps keep things in the workspace and how their files
//! are written, so a page, board or song it makes opens in the right app. Short: it goes with every turn.

pub const GUIDE: &str = r#"Where Mobius's apps keep things (workspace paths; folders are made as needed):
- Notes: notes/<notebook>/<page>.md · Docs: docs/<folder>/<doc>.md · Slides: slides/<folder>/<deck>.md, slides split by a line of ---; give each slide a look with a first line <!-- style: accent|dark|warm|light --> (accent to open, dark for section breaks, else light or warm).
- Research reports: research/<folder>/<report>.md · Reader articles: reading/<list>/<article>.md.
- Sheets, Tasks, Calendar, Mail, databases: their own tools (sheets.*, tasks.*, calendar.*, mail.*, db.*).
- Code projects: code/<project>/ · Skills: skills/<name>/SKILL.md.
- Design: designs/<folder>/<design>.json = {"version":1,"styles":[{"name","color"}],"frames":[{"id","name",x,y,w,h,fill,radius,stroke,strokeWidth,"component"?,"children":[{"id","type":"rect|ellipse|text|instance","name",x,y,w,h,fill,radius,stroke,strokeWidth,text,size,weight,color,hidden?,locked?,of,overrides}]}]}; colours #rrggbb or "style:<name>"; stroke = inner border; an instance copies the component frame "of", with overrides {<layer id>:{text,fill,color}}.
- Canvas boards: boards/<folder>/<board>.json = {"version":1,"items":[...]}, items: {"id":"s1","type":"sticky","x","y","w":180,"h":180,"color","text"}, {"type":"shape","shape":"rect|ellipse|diamond",x,y,w,h,color,text}, {"type":"text",x,y,w,h,text,"size"}, {"type":"arrow","from":<id>,"to":<id>,"text"}; colours yellow, orange, pink, green, blue, purple, grey, white.
- Views (dashboards): views/<folder>/<view>.json = {"version":1,"tiles":[{"id","kind":"mobius|tasks|calendar|mail|notes|next","size":"small|wide","title","show" (tasks: today|scheduled|flagged|all; calendar: today|week),"notebook"}]}; tiles show live data, never copy it.
- Music songs: studio/<folder>/<song>.json = {"version":1,"tempo","key","bars","tracks":[{"id","name","instrument":"piano|bass|pad|lead|drums","volume","notes":[{"pitch" (MIDI),"start","length" (beats),"velocity"}]}]}.
- Video: video/<project>/cut.json = {"version":1,"shots":[{"id","clip","in","out","title"}]}; never change the clips.
- Photo edits: photos/<album>/<photo>.edits.json = {"version":1,"adjustments":[{"id","name","exposure","highlights","shadows","contrast","saturation","warmth","tint","vignette" (each -100 to 100),"area":{"kind":"all|below|above|ellipse",...}}],"geometry" (optional):{"turns" (0-3),"flip","straighten" (-45 to 45),"crop":{"x","y","w","h"} (0 to 1)}}; that is how to crop and straighten. Never change the pictures.
When changing one of these files, keep the ids of what you leave alone and give new things new ids."#;

#[cfg(test)]
mod tests {
    #[test]
    fn the_guide_stays_short() {
        assert!(super::GUIDE.len() < 2600, "{}", super::GUIDE.len());
    }
}
