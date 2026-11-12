//! What the agent is told each turn about where the person's apps keep things in the workspace and how their files
//! are written, so a page, board or song it makes opens in the right app. Short: it goes with every turn.

pub const GUIDE: &str = r#"Where Mobius's apps keep things (paths from the workspace; folders are created as needed):
- Notes: notes/<notebook>/<page>.md · Docs: docs/<folder>/<doc>.md · Slides: slides/<folder>/<deck>.md, slides split by a line of ---; give each slide a look with a first line <!-- style: accent|dark|warm|light --> (accent for the opening slide, dark for section breaks, light or warm for the rest); a picture is a line ![](<deck> files/<name>) with the file in that folder, <!-- skip --> leaves a slide out of Play, and <!-- transition: none|push|move-in --> changes how Play moves on from it (Dissolve otherwise).
- Research reports: research/<folder>/<report>.md · Reader articles: reading/<list>/<article>.md.
- Sheets, Tasks, Calendar, Mail, databases: use their own tools (sheets.*, tasks.*, calendar.*, mail.*, db.*).
- Code projects: code/<project>/ · Skills: skills/<name>/SKILL.md.
- Design: designs/<folder>/<design>.json = {"version":1,"styles":[{"name","color"}],"frames":[{"id","name","x","y","w","h","fill","radius","children":[{"id","type":"rect|ellipse|text","name","x","y","w","h","fill","radius","text","size","weight","color"}]}]}; colours #rrggbb or "style:<name>".
- Canvas boards: boards/<folder>/<board>.json = {"version":1,"items":[...]}, one item per line: {"id":"s1","type":"sticky","x","y","w":180,"h":180,"color","text"}, {"type":"shape","shape":"rect|ellipse|diamond",x,y,w,h,color,text}, {"type":"text",x,y,w,h,text,"size"}, {"type":"arrow","from":<id>,"to":<id>,"text"}; colours yellow, orange, pink, green, blue, purple, grey, white.
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
