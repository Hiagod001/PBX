use super::*;
use crate::media::{Resampler, read_packet, write_pcm, uuid_bytes};
use axum::extract::Path;
use std::collections::HashSet;
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::{TcpListener,TcpStream}, sync::Notify};

#[derive(Clone, Serialize, Deserialize)]
pub struct Record {
    id: String,
    number: String,
    phase: String,
    result: String,
    started_at: u64,
    answered_at: u64,
    ended_at: u64,
    received_frames: u64,
    sent_frames: u64,
}
struct Media {
    to_wa: async_channel::Sender<Vec<i16>>,
    from_wa: async_channel::Receiver<Vec<i16>>,
}
struct Job {
    record: Mutex<Record>,
    cancel: AtomicBool,
    media: Mutex<Option<Media>>,
}
pub struct Gateway {
    secret: String,
    callback: String,
    jobs: Mutex<HashMap<String,Arc<Job>>>,
    accepted: Mutex<HashSet<String>>,
    wake: Notify,
}
#[derive(Deserialize)]
pub struct Start { id:String, number:String }
impl Gateway {
    #[cfg(test)]
    pub fn disabled()->Self {Self {secret:String::new(),callback:String::new(),jobs:Mutex::new(HashMap::new()),accepted:Mutex::new(HashSet::new()),wake:Notify::new()}}
    pub async fn new(data_dir: &str) -> anyhow::Result<Self> {
        let secret = if let Ok(file)=std::env::var("GATEWAY_SECRET_FILE") {
            let value=tokio::fs::read_to_string(file).await?.trim().to_owned();
            anyhow::ensure!(value.len()>=32,"Invalid gateway secret"); value
        } else { String::new() };
        let callback=std::env::var("PBX_CALLBACK_URL").unwrap_or_default();
        anyhow::ensure!(callback.is_empty() || (callback.starts_with("http://") && !callback.contains(['\r','\n','@'])),"Invalid private callback");
        let records:Vec<Record>=match tokio::fs::read(format!("{data_dir}/gateway-calls.json")).await {
            Ok(bytes)=>serde_json::from_slice(&bytes)?,
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>vec![],
            Err(e)=>return Err(e.into()),
        };
        let mut jobs=HashMap::new();
        for mut record in records {
            if record.phase!="ended" {record.phase="ended".into();record.result="interrupted".into();record.ended_at=now();}
            jobs.insert(record.id.clone(),Arc::new(Job {record:Mutex::new(record),cancel:AtomicBool::new(false),media:Mutex::new(None)}));
        }
        Ok(Self {secret,callback,jobs:Mutex::new(jobs),accepted:Mutex::new(HashSet::new()),wake:Notify::new()})
    }
    fn authorized(&self,h:&HeaderMap)->bool {
        !self.secret.is_empty() && h.get("authorization").and_then(|v|v.to_str().ok())
            .and_then(|v|v.strip_prefix("Bearer ")).is_some_and(|v|equal(v,&self.secret))
    }
    pub async fn accept(&self,id:&str) {
        let mut accepted=self.accepted.lock().await;
        if accepted.len()>64 {accepted.clear();}
        accepted.insert(id.to_owned()); self.wake.notify_waiters();
    }
    async fn persist(&self,app:&Lab)->anyhow::Result<()> {
        // Serialize snapshots under the jobs lock so an older write cannot replace a new one.
        let jobs=self.jobs.lock().await;
        let mut records=Vec::new();
        for job in jobs.values() {records.push(job.record.lock().await.clone());}
        let path=format!("{}/gateway-calls.json",app.data_dir);
        tokio::fs::write(format!("{path}.tmp"),serde_json::to_vec(&records)?).await?;
        tokio::fs::rename(format!("{path}.tmp"),path).await?; Ok(())
    }
}

pub async fn status(State(app):State<App>,h:HeaderMap)->ApiResult {
    if !app.gateway.authorized(&h) {return Err(error(StatusCode::UNAUTHORIZED,"Acesso não autorizado."));}
    let view=app.view.read().await;
    Ok(Json(serde_json::json!({"connected":view.connection=="connected" && view.account==app.lab_phone,
        "account":view.account,"connection":view.connection,"busy":app.busy.load(Ordering::SeqCst),"maxConcurrent":1})))
}
pub async fn get_call(State(app):State<App>,h:HeaderMap,Path(id):Path<String>)->ApiResult {
    if !app.gateway.authorized(&h) {return Err(error(StatusCode::UNAUTHORIZED,"Acesso não autorizado."));}
    let job=app.gateway.jobs.lock().await.get(&id).cloned().ok_or_else(||error(StatusCode::NOT_FOUND,"Ligação não encontrada."))?;
    Ok(Json(serde_json::to_value(job.record.lock().await.clone()).unwrap()))
}
pub async fn start(State(app):State<App>,h:HeaderMap,Json(request):Json<Start>)->ApiResult {
    if !app.gateway.authorized(&h) {return Err(error(StatusCode::UNAUTHORIZED,"Acesso não autorizado."));}
    if uuid_bytes(&request.id).is_none() || !valid_number(&request.number) || request.number==app.lab_phone {
        return Err(error(StatusCode::BAD_REQUEST,"Informe um número válido com país e DDD."));
    }
    let mut jobs=app.gateway.jobs.lock().await;
    if let Some(job)=jobs.get(&request.id) {
        let record=job.record.lock().await;
        if record.number!=request.number {return Err(error(StatusCode::CONFLICT,"Esta tentativa pertence a outro número."));}
        return Ok(Json(serde_json::to_value(&*record).unwrap()));
    }
    let view=app.view.read().await;
    if view.connection!="connected" || view.account!=app.lab_phone {
        return Err(error(StatusCode::SERVICE_UNAVAILABLE,"O WhatsApp está desconectado. Vincule a conta antes de iniciar."));
    }
    drop(view);
    // Retain seven days of idempotency keys. Never evict an active call.
    let old:Vec<String>=futures_old_records(&jobs).await;
    for id in old {jobs.remove(&id);}
    if jobs.len()>=10000 {return Err(error(StatusCode::SERVICE_UNAVAILABLE,"O histórico precisa de manutenção antes de continuar."));}
    if app.busy.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err() {
        return Err(error(StatusCode::CONFLICT,"Já existe uma ligação de WhatsApp em andamento."));
    }
    let record=Record {id:request.id.clone(),number:request.number,phase:"starting".into(),result:String::new(),
        started_at:now(),answered_at:0,ended_at:0,received_frames:0,sent_frames:0};
    let job=Arc::new(Job {record:Mutex::new(record.clone()),cancel:AtomicBool::new(false),media:Mutex::new(None)});
    jobs.insert(request.id,job.clone()); drop(jobs);
    if let Err(e)=app.gateway.persist(&app).await {
        log::error!("Gateway claim could not be persisted: {e}");
        let mut r=job.record.lock().await;r.phase="ended".into();r.result="storage_unavailable".into();r.ended_at=now();
        app.busy.store(false,Ordering::SeqCst);
        return Err(error(StatusCode::SERVICE_UNAVAILABLE,"Não foi possível salvar a tentativa. Nenhuma ligação foi enviada."));
    }
    tokio::spawn(run(app,job));
    Ok(Json(serde_json::to_value(record).unwrap()))
}
fn valid_number(number:&str)->bool {(12..=13).contains(&number.len()) && number.starts_with("55") && number.bytes().all(|c|c.is_ascii_digit())}
async fn futures_old_records(jobs:&HashMap<String,Arc<Job>>)->Vec<String> {
    let mut old=Vec::new();
    for (id,job) in jobs {let r=job.record.lock().await;if r.phase=="ended" && r.ended_at+7*86400<now() {old.push(id.clone());}}
    old
}
pub async fn hangup(State(app):State<App>,h:HeaderMap,Path(id):Path<String>)->ApiResult {
    if !app.gateway.authorized(&h) {return Err(error(StatusCode::UNAUTHORIZED,"Acesso não autorizado."));}
    let job=app.gateway.jobs.lock().await.get(&id).cloned().ok_or_else(||error(StatusCode::NOT_FOUND,"Ligação não encontrada."))?;
    job.cancel.store(true,Ordering::SeqCst); app.gateway.wake.notify_waiters();
    Ok(Json(serde_json::json!({"message":"Encerrando ligação."})))
}
async fn callback(app:&App,record:&Record) {
    if app.gateway.callback.is_empty() {return;}
    // The destination is fixed by deployment, never supplied by campaigns or callers.
    let url=&app.gateway.callback[7..];
    let (authority,path)=url.split_once('/').unwrap_or((url,""));
    let body=serde_json::to_string(record).unwrap();
    let request=format!("POST /{path} HTTP/1.1\r\nHost: {authority}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",app.gateway.secret,body.len());
    let response=tokio::time::timeout(Duration::from_secs(3),async {
        let mut stream=TcpStream::connect(authority).await?;
        stream.write_all(request.as_bytes()).await?;
        let mut response=[0;64];let size=stream.read(&mut response).await?;
        anyhow::ensure!(String::from_utf8_lossy(&response[..size]).starts_with("HTTP/1.1 200"),"PBX callback rejected");
        Ok::<_,anyhow::Error>(())
    }).await;
    if !matches!(response,Ok(Ok(()))) {log::warn!("PBX notification unavailable; status reconciliation will recover it");}
}
async fn run(app:App,job:Arc<Job>) {
    let outcome=run_inner(&app,&job).await;
    let reason=match outcome {Ok(reason)=>reason,Err(e)=>{
        log::error!("WhatsApp campaign call failed: {e}");
        match e.downcast_ref::<DestinationError>() {Some(DestinationError::NotRecognized)=>"not_registered",Some(_)=>"lookup_failed",None=>"connection_failed"}.into()
    }};
    job.cancel.store(true,Ordering::SeqCst);
    if let Some(handle)=app.active.lock().await.take() {terminate(&app,&handle).await;}
    let record={let mut r=job.record.lock().await;r.phase="ended".into();r.result=reason;r.ended_at=now();r.clone()};
    if let Err(e)=app.gateway.persist(&app).await {log::error!("Could not save campaign result: {e}");}
    callback(&app,&record).await;
    app.busy.store(false,Ordering::SeqCst);
}
async fn run_inner(app:&App,job:&Arc<Job>)->anyhow::Result<String> {
    let client=app.client.read().await.clone().ok_or_else(||anyhow::anyhow!("Disconnected"))?;
    let number=job.record.lock().await.number.clone();
    let peer=resolve_destination(&client,&format!("{number}@s.whatsapp.net").parse()?).await?;
    if job.cancel.load(Ordering::SeqCst) {return Ok("canceled".into());}
    let mut decoder=whatsapp_rust::voip::audio::WaOpusDecoder::new()?;
    let (mic_tx,mic_rx)=async_channel::bounded(4);
    let (speaker_tx,speaker_rx)=async_channel::bounded::<Vec<i16>>(12);
    let (to_wa,from_pbx)=async_channel::bounded::<Vec<i16>>(6);
    let (to_pbx,from_wa)=async_channel::bounded::<Vec<i16>>(12);
    *job.media.lock().await=Some(Media{to_wa,from_wa});
    let send_job=job.clone();
    let send=tokio::spawn(async move {
        let mut clock=tokio::time::interval(Duration::from_millis(60));
        clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut pending=VecDeque::new();
        loop {
            clock.tick().await;
            if send_job.cancel.load(Ordering::SeqCst) {break;}
            while let Ok(pcm)=from_pbx.try_recv(){pending.extend(pcm);}
            if pending.len()>4800 {pending.drain(..pending.len()-1920);}
            let frame=take_pcm_frame(&mut pending).unwrap_or_else(||vec![0;960]);
            if mic_tx.send(frame).await.is_err(){break;}
            send_job.record.lock().await.sent_frames+=1;
        }
    });
    let receive_job=job.clone();
    let receive=tokio::spawn(async move {
        while let Ok(frame)=speaker_rx.recv().await {
            receive_job.record.lock().await.received_frames+=1;
            let _=to_pbx.try_send(frame);
        }
    });
    let setup=tokio::time::timeout(Duration::from_secs(35),client.voip().call(&peer).audio(mic_rx,speaker_tx.clone()).start()).await;
    let handle=match setup {Ok(Ok(h))=>h,other=>{
        send.abort();receive.abort();
        return match other {Ok(Err(e))=>Err(e.into()),_=>Err(anyhow::anyhow!("Call setup timeout"))};
    }};
    *app.active.lock().await=Some(handle.clone());
    {job.record.lock().await.phase="ringing".into();}
    let events=handle.events();let ended=handle.wait_ended();tokio::pin!(ended);
    let started=Instant::now();let mut answered=None;
    let mut tick=tokio::time::interval(Duration::from_millis(100));
    let result=loop {
        tokio::select! {
            _=&mut ended=>break if answered.is_some(){"completed"}else{"no_answer"}.into(),
            _=app.gateway.wake.notified()=>{},
            _=tick.tick()=>{},
            event=events.recv()=>match event {
                Ok(CallEvent::ForeignAudio(payload))=>if let Ok(pcm)=decoder.decode_mlow_escape(&payload){let _=speaker_tx.try_send(pcm.to_vec());},
                Ok(CallEvent::RelayAllocateFailed(_)|CallEvent::RelayAllocateTimedOut|CallEvent::RelayReconnectTimedOut)=>break "media_failed".into(),
                Ok(CallEvent::AudioFormatMismatch{..})=>break "media_failed".into(),
                Ok(_)=>{},Err(_)=>break "connection_failed".into(),
            }
        }
        if job.cancel.load(Ordering::SeqCst){break if answered.is_some(){"completed"}else{"canceled"}.into();}
        if answered.is_none() && app.gateway.accepted.lock().await.remove(handle.call_id()) {
            answered=Some(Instant::now());
            let record={let mut r=job.record.lock().await;r.phase="answered".into();r.answered_at=now();r.clone()};
            if let Err(e)=app.gateway.persist(app).await {log::error!("Answer persistence failed: {e}");break "storage_unavailable".into();}
            let callback_app=app.clone();tokio::spawn(async move {callback(&callback_app,&record).await;});
        }
        if answered.is_none() && started.elapsed()>Duration::from_secs(45){break "no_answer".into();}
        if let Some(at)=answered {
            if at.elapsed()>Duration::from_secs(20) && job.record.lock().await.phase!="bridged" {break "bridge_failed".into();}
            if at.elapsed()>Duration::from_secs(2*3600){break "time_limit".into();}
        }
    };
    job.cancel.store(true,Ordering::SeqCst);send.abort();receive.abort();
    Ok(result)
}

pub async fn listen(app:App)->anyhow::Result<()> {
    if app.gateway.secret.is_empty(){return Ok(());}
    let listener=TcpListener::bind("0.0.0.0:9099").await?;
    loop {let (stream,_)=listener.accept().await?;let app=app.clone();tokio::spawn(async move {
        if let Err(e)=socket(app,stream).await {log::debug!("Media connection closed: {e}");}
    });}
}
async fn socket(app:App,mut stream:TcpStream)->anyhow::Result<()> {
    stream.set_nodelay(true)?;
    let (kind,uuid)=tokio::time::timeout(Duration::from_secs(3),read_packet(&mut stream)).await??;
    anyhow::ensure!(kind==1 && uuid.len()==16,"Invalid AudioSocket identity");
    let jobs=app.gateway.jobs.lock().await;
    let mut matched=None;
    for (id,job) in jobs.iter() {if uuid_bytes(id).as_ref()==Some(&uuid) {matched=Some(job.clone());break;}}
    drop(jobs);
    let job=matched.ok_or_else(||anyhow::anyhow!("Unknown call"))?;
    let mut record=job.record.lock().await;
    anyhow::ensure!(record.phase=="answered" && !job.cancel.load(Ordering::SeqCst),"Call not awaiting media");
    let media=job.media.lock().await.take().ok_or_else(||anyhow::anyhow!("Media already attached"))?;
    record.phase="bridged".into();drop(record);
    let (mut reader,mut writer)=stream.into_split();
    let read_job=job.clone();
    let receive=async move {
        let mut up=Resampler::new();
        loop {
            let (kind,data)=read_packet(&mut reader).await?;
            if kind==0 {break;}
            if kind==0x03 {continue;}
            anyhow::ensure!(kind==0x10 && data.len()%2==0,"Unsupported PCM format");
            let pcm:Vec<i16>=data.chunks_exact(2).map(|s|i16::from_le_bytes([s[0],s[1]])).collect();
            let _=media.to_wa.try_send(up.up(&pcm));
            if read_job.cancel.load(Ordering::SeqCst){break;}
        }
        Ok::<_,anyhow::Error>(())
    };
    let send_job=job.clone();
    let send=async move {
        let mut clock=tokio::time::interval(Duration::from_millis(20));
        clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut down=Resampler::new();let mut pending=VecDeque::new();
        loop {
            clock.tick().await;
            if send_job.cancel.load(Ordering::SeqCst){break;}
            while let Ok(frame)=media.from_wa.try_recv(){pending.extend(down.down(&frame));}
            if pending.len()>4000 {pending.drain(..pending.len()-800);}
            let pcm:Vec<i16>=if pending.len()>=160 {pending.drain(..160).collect()}else{vec![0;160]};
            tokio::time::timeout(Duration::from_secs(2),write_pcm(&mut writer,&pcm)).await??;
        }
        Ok::<_,anyhow::Error>(())
    };
    tokio::select!{_ = receive=>{},_ = send=>{}}
    job.cancel.store(true,Ordering::SeqCst);app.gateway.wake.notify_waiters();Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn phone_validation_does_not_guess_or_accept_dialplan_injection() {
        assert!(valid_number("553431950861"));assert!(valid_number("5534991708282"));
        for input in ["34991708282","5534;System(echo)","+553431950861","553431950861\n"] {assert!(!valid_number(input));}
    }
    fn record(phase:&str)->Record {Record{id:"d6cf5f8e-03ac-44b3-91ae-39f34e7b206c".into(),number:"553431950861".into(),phase:phase.into(),result:String::new(),started_at:now(),answered_at:0,ended_at:0,received_frames:0,sent_frames:0}}
    #[tokio::test]
    async fn machine_auth_and_duplicate_keys_never_start_a_second_call() {
        let mut app=crate::tests::fixture();
        Arc::get_mut(&mut app).unwrap().gateway.secret="separate-machine-key-with-at-least-32-characters".into();
        assert_eq!(status(State(app.clone()),HeaderMap::new()).await.unwrap_err().0,StatusCode::UNAUTHORIZED);
        let mut h=HeaderMap::new();h.insert("authorization",HeaderValue::from_static("Bearer separate-machine-key-with-at-least-32-characters"));
        let r=record("ended");
        app.gateway.jobs.lock().await.insert(r.id.clone(),Arc::new(Job{record:Mutex::new(r.clone()),cancel:AtomicBool::new(false),media:Mutex::new(None)}));
        let result=start(State(app.clone()),h.clone(),Json(Start{id:r.id.clone(),number:r.number})).await.unwrap();
        assert_eq!(result.0["phase"],"ended");
        assert!(!app.busy.load(Ordering::SeqCst));assert!(app.active.lock().await.is_none());
        assert_eq!(start(State(app),h,Json(Start{id:r.id,number:"5534991708282".into()})).await.unwrap_err().0,StatusCode::CONFLICT);
    }
    #[tokio::test]
    async fn restart_marks_unfinished_calls_for_review_without_redialing() {
        let directory=std::env::temp_dir().join(format!("wa-journal-{}",random_token()));
        tokio::fs::create_dir(&directory).await.unwrap();
        let r=record("answered");
        tokio::fs::write(directory.join("gateway-calls.json"),serde_json::to_vec(&vec![r.clone()]).unwrap()).await.unwrap();
        let restored=Gateway::new(directory.to_str().unwrap()).await.unwrap();
        let jobs=restored.jobs.lock().await;
        let result=jobs[&r.id].record.lock().await;
        assert_eq!(result.phase,"ended");assert_eq!(result.result,"interrupted");assert!(result.ended_at>0);
        assert!(jobs[&r.id].media.lock().await.is_none());
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }
}
