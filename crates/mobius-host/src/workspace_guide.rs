//! What the agent is told each turn about where the person's apps keep things in the workspace and how their files
//! are written, so a page, board or song it makes opens in the right app. Short: it goes with every turn.

pub const GUIDE: &str = r#"Where Mobius's apps keep things (paths from the workspace; folders are created as needed):
- Notes: notes/<notebook>/<page>.md · Docs: docs/<folder>/<doc>.md · Slides: slides/<folder>/<deck>.md, slides split by a line of ---.
- Research reports: research/<folder>/<report>.md · Reader articles: reading/<list>/<article>.md.
- Sheets, Tasks, Calendar, Mail, databases: use their own tools (sheets.*, tasks.*, calendar.*, mail.*, db.*).
- Code projects: code/<project>/ · Skills: skills/<name>/SKILL.md.
- Design: designs/<folder>/<design>.json = {"version":1,"styles":[{"name","color"}],"frames":[{"id","name","x","y","w","h","fill","radius","children":[{"id","type":"rect|ellipse|text","name","x","y","w","h","fill","radius","text","size","weight","color"}]}]}; colours #rrggbb or "style:<name>".
- Canvas boards: boards/<folder>/<board>.json = {"version":1,"items":[...]}, one item per line: {"id":"s1","type":"sticky","x","y","w":180,"h":180,"color","text"}, {"type":"shape","shape":"rect|ellipse|diamond",x,y,w,h,color,text}, {"type":"text",x,y,w,h,text,"size"}, {"type":"arrow","from":<id>,"to":<id>,"text"}; colours yellow, orange, pink, green, blue, purple, grey, white.
- Music songs: studio/<folder>/<song>.json = {"version":1,"tempo","key","bars","tracks":[{"id","name","instrument":"piano|bass|pad|lead|drums","volume","notes":[{"pitch" (MIDI),"start","length" (beats),"velocity"}]}]}.
- Video: video/<project>/cut.json = {"version":1,"shots":[{"id","clip","in","out","title"}]}; never change the clips.
- Photo edits: photos/<album>/<photo>.edits.json; never change the pictures.
When changing one of these files, keep the ids of what you leave alone and give new things new ids."#;

#[cfg(test)]
mod tests {
    #[test]
    fn the_guide_stays_short() {
        assert!(super::GUIDE.len() < 2600, "{}", super::GUIDE.len());
    }
}
