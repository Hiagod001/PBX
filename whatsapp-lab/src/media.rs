//! Asterisk 20.6 AudioSocket uses 8 kHz signed little-endian PCM (type 0x10).
//! WhatsApp uses 16 kHz PCM. Keep filter history across packets in both directions.
use std::collections::VecDeque;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub struct Resampler {
    taps: Vec<f64>,
    history: VecDeque<f64>,
    odd: bool,
}
impl Resampler {
    pub fn new() -> Self {
        let n = 47;
        let mut taps: Vec<f64> = (0..n).map(|i| {
            let x = i as f64 - (n - 1) as f64 / 2.0;
            let cutoff = 0.225;
            let sinc = if x == 0.0 { 2.0 * cutoff } else {
                (2.0 * std::f64::consts::PI * cutoff * x).sin() / (std::f64::consts::PI * x)
            };
            sinc * (0.54 - 0.46 * (2.0 * std::f64::consts::PI * i as f64 / (n - 1) as f64).cos())
        }).collect();
        let gain: f64 = taps.iter().sum();
        for t in &mut taps { *t /= gain; }
        Self { history: VecDeque::from(vec![0.0; n]), taps, odd: false }
    }
    fn filter(&mut self, value: f64) -> i16 {
        self.history.pop_back();
        self.history.push_front(value);
        self.history.iter().zip(&self.taps).map(|(v,t)|v*t).sum::<f64>()
            .round().clamp(i16::MIN as f64, i16::MAX as f64) as i16
    }
    pub fn down(&mut self, input: &[i16]) -> Vec<i16> {
        let mut out = Vec::with_capacity(input.len()/2+1);
        for &v in input {
            let sample = self.filter(v as f64);
            self.odd = !self.odd;
            if !self.odd { out.push(sample); }
        }
        out
    }
    pub fn up(&mut self, input: &[i16]) -> Vec<i16> {
        let mut out = Vec::with_capacity(input.len()*2);
        for &v in input {
            out.push(self.filter(v as f64 * 2.0));
            out.push(self.filter(0.0));
        }
        out
    }
}

pub async fn read_packet<R: AsyncRead + Unpin>(stream: &mut R) -> anyhow::Result<(u8, Vec<u8>)> {
    let mut header = [0u8;3];
    stream.read_exact(&mut header).await?;
    let length = u16::from_be_bytes([header[1],header[2]]) as usize;
    anyhow::ensure!(length <= 4096, "Oversized media packet");
    let mut data = vec![0;length];
    stream.read_exact(&mut data).await?;
    Ok((header[0],data))
}
pub async fn write_pcm<W: AsyncWrite + Unpin>(stream: &mut W, pcm: &[i16]) -> anyhow::Result<()> {
    let len = (pcm.len()*2) as u16;
    let mut data = vec![0x10,(len>>8) as u8,len as u8];
    for v in pcm { data.extend_from_slice(&v.to_le_bytes()); }
    stream.write_all(&data).await?;
    Ok(())
}
pub fn uuid_bytes(id: &str) -> Option<Vec<u8>> {
    if id.len()!=36 || [8,13,18,23].iter().any(|&i|id.as_bytes()[i]!=b'-') { return None; }
    let hex: String = id.chars().filter(|&c|c!='-').collect();
    if hex.len()!=32 || !hex.bytes().all(|c|c.is_ascii_hexdigit()) { return None; }
    (0..32).step_by(2).map(|i|u8::from_str_radix(&hex[i..i+2],16).ok()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resampling_keeps_packet_boundaries_and_suppresses_aliases() {
        let wave = |hz:f64| (0..16000).map(|n|(10000.0*(2.0*std::f64::consts::PI*hz*n as f64/16000.0).sin()) as i16).collect::<Vec<_>>();
        let input=wave(1000.0);
        let whole=Resampler::new().down(&input);
        let mut sampler=Resampler::new();
        let packets:Vec<i16>=input.chunks(319).flat_map(|x|sampler.down(x)).collect();
        assert_eq!(whole,packets);
        let rms=|x:&[i16]| (x[100..].iter().map(|v|(*v as f64).powi(2)).sum::<f64>()/(x.len()-100) as f64).sqrt();
        assert!(rms(&whole)>6500.0);
        assert!(rms(&Resampler::new().down(&wave(6000.0)))<150.0);
        assert_eq!(Resampler::new().up(&whole).len(),16000);
    }
    #[tokio::test]
    async fn packets_handle_fragmented_tcp_and_reject_oversize() {
        let (mut tx,mut rx)=tokio::io::duplex(128);
        tokio::spawn(async move { for b in [0x10,0,4,1,0,2,0] {tx.write_all(&[b]).await.unwrap();} });
        assert_eq!(read_packet(&mut rx).await.unwrap(),(0x10,vec![1,0,2,0]));
        assert!(read_packet(&mut &[0x10,0xff,0xff][..]).await.is_err());
        assert!(uuid_bytes("../../etc/passwd").is_none());
        assert_eq!(uuid_bytes("d6cf5f8e-03ac-44b3-91ae-39f34e7b206c").unwrap().len(),16);
    }
}
