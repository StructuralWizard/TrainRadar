//! Minimal JSON writing, so the WASM bundle doesn't need serde_json.

use std::fmt::Write;

/// Append `s` as a JSON string literal.
pub fn str(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Builder for one JSON object.
#[derive(Debug)]
pub struct Obj<'a> {
    out: &'a mut String,
    first: bool,
}

impl<'a> Obj<'a> {
    pub fn new(out: &'a mut String) -> Self {
        out.push('{');
        Self { out, first: true }
    }

    fn key(&mut self, k: &str) {
        if !self.first {
            self.out.push(',');
        }
        self.first = false;
        str(self.out, k);
        self.out.push(':');
    }

    pub fn s(&mut self, k: &str, v: &str) -> &mut Self {
        self.key(k);
        str(self.out, v);
        self
    }

    pub fn n(&mut self, k: &str, v: impl std::fmt::Display) -> &mut Self {
        self.key(k);
        let _ = write!(self.out, "{v}");
        self
    }

    /// Number, or `null` for `None` and non-finite floats.
    pub fn on<T: std::fmt::Display>(&mut self, k: &str, v: Option<T>) -> &mut Self {
        self.key(k);
        match v {
            Some(v) => {
                let s = v.to_string();
                if s == "NaN" || s.contains("inf") {
                    self.out.push_str("null");
                } else {
                    self.out.push_str(&s);
                }
            }
            None => self.out.push_str("null"),
        }
        self
    }

    pub fn os(&mut self, k: &str, v: Option<&str>) -> &mut Self {
        self.key(k);
        match v {
            Some(v) => str(self.out, v),
            None => self.out.push_str("null"),
        }
        self
    }

    pub fn b(&mut self, k: &str, v: bool) -> &mut Self {
        self.key(k);
        self.out.push_str(if v { "true" } else { "false" });
        self
    }

    /// Raw, already-encoded JSON value.
    pub fn raw(&mut self, k: &str, v: &str) -> &mut Self {
        self.key(k);
        self.out.push_str(v);
        self
    }

    pub fn end(&mut self) {
        self.out.push('}');
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_and_builds_objects() {
        let mut s = String::new();
        Obj::new(&mut s)
            .s("a", "x\"y\\\n<\u{1}>")
            .n("b", 2)
            .on::<i32>("c", None)
            .on("d", Some(f64::NAN))
            .b("e", true)
            .raw("f", "[1]")
            .end();
        assert_eq!(
            s,
            r#"{"a":"x\"y\\\n<\u0001>","b":2,"c":null,"d":null,"e":true,"f":[1]}"#
        );
    }
}
