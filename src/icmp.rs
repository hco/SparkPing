use socket2::{Domain, Protocol, Socket, Type};
use std::io::{self, Read};
use std::net::{IpAddr, SocketAddr};
use std::time::{Duration, Instant};
use tracing::debug;

const ICMP_ECHO_REQUEST: u8 = 8;
const ICMP_ECHO_REPLY: u8 = 0;
const ICMP_HEADER_SIZE: usize = 8;
const PAYLOAD_SIZE: usize = 24;
const PACKET_SIZE: usize = ICMP_HEADER_SIZE + PAYLOAD_SIZE;

pub fn ping_dgram(addr: IpAddr, timeout: Duration, ident: u16, seq: u16) -> io::Result<Duration> {
    let start = Instant::now();
    let dest = SocketAddr::new(addr, 0);

    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::ICMPV4))
        .map_err(|e| io::Error::new(e.kind(), format!("socket create failed: {}", e)))?;
    socket.set_ttl_v4(64)?;
    socket.set_write_timeout(Some(timeout))?;

    // Build ICMP echo request
    let mut packet = [0u8; PACKET_SIZE];
    packet[0] = ICMP_ECHO_REQUEST;
    packet[1] = 0; // code
    // checksum at [2..4], filled below
    packet[4] = (ident >> 8) as u8;
    packet[5] = ident as u8;
    packet[6] = (seq >> 8) as u8;
    packet[7] = seq as u8;
    // payload: fill with ident bytes for identification
    for i in ICMP_HEADER_SIZE..PACKET_SIZE {
        packet[i] = (ident & 0xff) as u8;
    }
    write_checksum(&mut packet);

    socket
        .send_to(&packet, &dest.into())
        .map_err(|e| io::Error::new(e.kind(), format!("send failed: {}", e)))?;

    debug!(target = %addr, "send_to succeeded, waiting for reply");

    // Read replies until we find ours or timeout
    loop {
        let elapsed = start.elapsed();
        if elapsed >= timeout {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "ping timed out (no reply received)"));
        }
        socket.set_read_timeout(Some(timeout - elapsed))?;

        let mut buf = [0u8; 2048];
        match (&socket).read(&mut buf) {
            Ok(n) if n < ICMP_HEADER_SIZE => continue,
            Ok(n) => {
                // DGRAM socket: buffer starts with ICMP header directly (no IP header).
                // The kernel handles ident matching for DGRAM sockets — any reply
                // delivered to our socket is already ours, so just check the type.
                let reply_type = buf[0];

                if reply_type == ICMP_ECHO_REPLY {
                    return Ok(start.elapsed());
                }
                debug!(
                    target = %addr,
                    "got non-reply ICMP packet: type={}, len={}",
                    reply_type, n
                );
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "read timed out waiting for reply (send succeeded)",
                ));
            }
            Err(e) => {
                return Err(io::Error::new(e.kind(), format!("read failed: {}", e)));
            }
        }
    }
}

fn write_checksum(buf: &mut [u8]) {
    // Clear checksum field first
    buf[2] = 0;
    buf[3] = 0;

    let mut sum = 0u32;
    for chunk in buf.chunks(2) {
        let word = (u16::from(chunk[0]) << 8)
            + if chunk.len() > 1 {
                u16::from(chunk[1])
            } else {
                0
            };
        sum = sum.wrapping_add(u32::from(word));
    }
    while (sum >> 16) > 0 {
        sum = (sum & 0xffff) + (sum >> 16);
    }
    let checksum = !sum as u16;
    buf[2] = (checksum >> 8) as u8;
    buf[3] = (checksum & 0xff) as u8;
}
