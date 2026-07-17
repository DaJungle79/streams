//! The Apple Reminders mirror's shell layer (SPEC §4.5).
//!
//! Deliberately dumb: it takes strings and runs `osascript`. Every decision --
//! what should exist, what changed, what to delete -- happens in TypeScript
//! (`mirrorSet.ts`), where it is testable without Apple Events.
//!
//! AppleScript over EventKit because EventKit is an Objective-C framework, and
//! reaching it from Rust means objc2 bindings plus an async authorization flow.
//! That would put real Apple-framework surface back into a Rust layer that is
//! meant to be thin glue -- the exact complication the whole stack change was
//! for. The cost is latency (~100-300ms/call), which doesn't matter for a
//! handful of items reconciled off the interaction path.

use std::process::Command;

/// Never the user's default list.
///
/// The prior implementation of this app learned it the hard way:
/// `defaultCalendarForNewReminders()` can resolve to a list or account you
/// aren't looking at, so a reminder saves successfully and "doesn't appear".
/// A dedicated list is also what makes deletion safe -- we only ever touch
/// reminders we created.
const LIST_NAME: &str = "Streams";

fn run(script: &str) -> Result<String, String> {
    let out = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("failed to spawn osascript: {e}"))?;

    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// AppleScript string literals take `"` and `\` escapes, and a raw newline ends
/// a statement. Notes are multi-line and user-authored, so this is not optional.
fn escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "")
}

/// A `YYYY-MM-DD` day as an AppleScript date, built field by field.
///
/// `date "2026-09-14"` parses against the *user's locale*, so on a machine set
/// to en-GB vs en-US the same string can mean different days -- or fail. Setting
/// the components explicitly is the only locale-proof way.
///
/// 09:00 local, because a reminder due "today" at midnight has already been
/// overdue for nine hours by the time you look at it.
fn date_expr(day: &str) -> Option<String> {
    let mut parts = day.split('-');
    let y: i32 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    let d: u32 = parts.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    Some(format!(
        r#"set dueDate to (current date)
           set year of dueDate to {y}
           set month of dueDate to {m}
           set day of dueDate to {d}
           set time of dueDate to 9 * hours"#
    ))
}

fn ensure_list_snippet() -> String {
    format!(
        r#"if not (exists list "{LIST_NAME}") then
               make new list with properties {{name:"{LIST_NAME}"}}
           end if"#
    )
}

#[tauri::command]
pub fn reminders_create(title: String, notes: String, due: Option<String>) -> Result<String, String> {
    let due_setup = due.as_deref().and_then(date_expr);
    let props = if due_setup.is_some() {
        format!(
            r#"{{name:"{}", body:"{}", due date:dueDate}}"#,
            escape(&title),
            escape(&notes)
        )
    } else {
        format!(r#"{{name:"{}", body:"{}"}}"#, escape(&title), escape(&notes))
    };

    let script = format!(
        r#"tell application "Reminders"
               {ensure}
               {due}
               set r to make new reminder at end of list "{LIST_NAME}" with properties {props}
               return id of r
           end tell"#,
        ensure = ensure_list_snippet(),
        due = due_setup.unwrap_or_default(),
    );
    run(&script)
}

#[tauri::command]
pub fn reminders_update(
    id: String,
    title: String,
    notes: String,
    due: Option<String>,
) -> Result<(), String> {
    let due_setup = due.as_deref().and_then(date_expr);
    let due_stmt = if due_setup.is_some() {
        "set due date of r to dueDate"
    } else {
        // Clearing matters: a milestone can be removed, and a stale due date
        // would keep nagging about a date that no longer exists.
        "set due date of r to missing value"
    };

    let script = format!(
        r#"tell application "Reminders"
               set r to first reminder whose id is "{id}"
               set name of r to "{title}"
               set body of r to "{notes}"
               {due}
               {due_stmt}
           end tell"#,
        title = escape(&title),
        notes = escape(&notes),
        due = due_setup.unwrap_or_default(),
    );
    run(&script).map(|_| ())
}

/// Delete by id. Missing is success: the user may have deleted it by hand, and
/// the desired end state -- no such reminder -- already holds.
#[tauri::command]
pub fn reminders_delete(id: String) -> Result<(), String> {
    let script = format!(
        r#"tell application "Reminders"
               try
                   delete (first reminder whose id is "{id}")
               end try
           end tell"#
    );
    run(&script).map(|_| ())
}

/// Ids currently in our list. Used to heal a map that has drifted from reality
/// -- e.g. reminders deleted on the phone, or a map file restored from backup.
#[tauri::command]
pub fn reminders_list_ids() -> Result<Vec<String>, String> {
    let script = format!(
        r#"tell application "Reminders"
               {ensure}
               set out to {{}}
               repeat with r in reminders of list "{LIST_NAME}"
                   set end of out to id of r
               end repeat
               set AppleScript's text item delimiters to linefeed
               return out as text
           end tell"#,
        ensure = ensure_list_snippet(),
    );
    let raw = run(&script)?;
    Ok(raw.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_closes_the_injection_hole() {
        // A stream titled `" & (do shell script "rm -rf ~") & "` must stay text.
        assert_eq!(escape(r#"a"b"#), r#"a\"b"#);
        assert_eq!(escape(r"a\b"), r"a\\b");
        assert_eq!(escape("a\nb"), r"a\nb");
        assert_eq!(escape("a\r\nb"), r"a\nb");
    }

    #[test]
    fn date_expr_is_locale_proof_and_rejects_nonsense() {
        let e = date_expr("2026-09-14").unwrap();
        assert!(e.contains("set year of dueDate to 2026"));
        assert!(e.contains("set month of dueDate to 9"));
        assert!(e.contains("set day of dueDate to 14"));
        // No locale-parsed date literal anywhere.
        assert!(!e.contains("date \""));

        assert!(date_expr("not-a-date").is_none());
        assert!(date_expr("2026-13-01").is_none());
        assert!(date_expr("2026-09-99").is_none());
        assert!(date_expr("").is_none());
    }
}
