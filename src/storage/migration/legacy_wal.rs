use crate::storage::legacy_layout::{legacy_wal_segments, LEGACY_WAL_DIRS};
use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, BufReader, Read};
use std::path::{Path, PathBuf};
use tsink::Label;

/// A row from a tsink 0.5 WAL segment.
#[derive(Debug)]
pub struct WalRow {
    pub metric: String,
    pub labels: Vec<Label>,
    pub timestamp: i64,
    pub value: f64,
}

/// Streams rows from all legacy WAL segments, oldest segment first, without
/// loading a segment into memory (segments can be gigabytes).
pub struct LegacyWal {
    pending: VecDeque<PathBuf>,
    current: Option<(PathBuf, BufReader<File>)>,
    peeked: Option<WalRow>,
    finished: Vec<PathBuf>,
    total_bytes: u64,
    finished_bytes: u64,
}

impl LegacyWal {
    pub fn open(legacy_dir: &Path) -> io::Result<Self> {
        let mut pending = VecDeque::new();
        for dir_name in LEGACY_WAL_DIRS {
            let dir = legacy_dir.join(dir_name);
            if dir.is_dir() {
                pending.extend(legacy_wal_segments(&dir)?);
            }
        }
        let total_bytes = pending
            .iter()
            .filter_map(|p| std::fs::metadata(p).ok())
            .map(|m| m.len())
            .sum();
        Ok(Self {
            pending,
            current: None,
            peeked: None,
            finished: Vec::new(),
            total_bytes,
            finished_bytes: 0,
        })
    }

    pub fn total_bytes(&self) -> u64 {
        self.total_bytes
    }

    /// Bytes of segments read to the end so far.
    pub fn finished_bytes(&self) -> u64 {
        self.finished_bytes
    }

    pub fn peek(&mut self) -> io::Result<Option<&WalRow>> {
        if self.peeked.is_none() {
            self.peeked = self.read_next()?;
        }
        Ok(self.peeked.as_ref())
    }

    pub fn next_row(&mut self) -> io::Result<Option<WalRow>> {
        match self.peeked.take() {
            Some(row) => Ok(Some(row)),
            None => self.read_next(),
        }
    }

    /// Segments read to the end since the last call; their rows have all been
    /// returned by `next_row`.
    pub fn take_finished(&mut self) -> Vec<PathBuf> {
        std::mem::take(&mut self.finished)
    }

    fn read_next(&mut self) -> io::Result<Option<WalRow>> {
        loop {
            if self.current.is_none() {
                let Some(path) = self.pending.pop_front() else {
                    return Ok(None);
                };
                let reader = BufReader::with_capacity(1 << 20, File::open(&path)?);
                self.current = Some((path, reader));
            }
            if let Some((_, reader)) = &mut self.current {
                if let Some(row) = read_row(reader) {
                    return Ok(Some(row));
                }
            }
            // End of segment (or a torn write at its end, which a crash can leave).
            if let Some((path, _)) = self.current.take() {
                self.finished_bytes += std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                self.finished.push(path);
            }
        }
    }
}

/// tsink 0.5 WAL record: op (u8, 0 = insert), uvarint name length, marshaled
/// metric name with labels, zigzag varint timestamp, uvarint f64 bits.
/// Returns None at the end of the segment or on a truncated/unknown record.
fn read_row(reader: &mut impl Read) -> Option<WalRow> {
    let mut op = [0u8; 1];
    reader.read_exact(&mut op).ok()?;
    if op[0] != 0 {
        return None;
    }
    let name_len = usize::try_from(decode_uvarint(reader).ok()?).ok()?;
    // Marshaled names are a few hundred bytes; anything huge is corruption.
    if name_len > 64 * 1024 {
        return None;
    }
    let mut name = vec![0u8; name_len];
    reader.read_exact(&mut name).ok()?;
    let (metric, labels) = unmarshal_metric_name(&name);
    let timestamp = decode_varint(reader).ok()?;
    let value = f64::from_bits(decode_uvarint(reader).ok()?);
    Some(WalRow {
        metric,
        labels,
        timestamp,
        value,
    })
}

fn decode_uvarint(reader: &mut impl Read) -> io::Result<u64> {
    let mut result = 0u64;
    let mut shift = 0u32;
    loop {
        let mut byte = [0u8; 1];
        reader.read_exact(&mut byte)?;
        result |= ((byte[0] & 0x7F) as u64) << shift;
        if byte[0] & 0x80 == 0 {
            return Ok(result);
        }
        shift += 7;
        if shift >= 64 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "varint overflow",
            ));
        }
    }
}

fn decode_varint(reader: &mut impl Read) -> io::Result<i64> {
    let uvalue = decode_uvarint(reader)?;
    Ok(((uvalue >> 1) as i64) ^ -((uvalue & 1) as i64))
}

/// Format: [metric_len: u16 LE][metric][name_len: u16 LE][name][value_len: u16 LE][value]...
/// A buffer without a length prefix is a plain metric name without labels.
fn unmarshal_metric_name(data: &[u8]) -> (String, Vec<Label>) {
    let read_str = |pos: &mut usize| -> Option<String> {
        let len_bytes = data.get(*pos..*pos + 2)?;
        let len = u16::from_le_bytes([len_bytes[0], len_bytes[1]]) as usize;
        let s = data.get(*pos + 2..*pos + 2 + len)?;
        *pos += 2 + len;
        Some(String::from_utf8_lossy(s).into_owned())
    };

    let mut pos = 0;
    let Some(metric) = read_str(&mut pos) else {
        return (String::from_utf8_lossy(data).into_owned(), Vec::new());
    };
    let mut labels = Vec::new();
    while let (Some(name), Some(value)) = (read_str(&mut pos), read_str(&mut pos)) {
        labels.push(Label::new(name, value));
    }
    (metric, labels)
}
