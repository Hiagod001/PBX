use axum::{
    Form, Json, Router,
    extract::State,
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Mutex, RwLock};
use whatsapp_rust::{
    prelude::*,
    voip::{CallEvent, CallHandle},
};

const MAX_CALL: Duration = Duration::from_secs(90);
const MAX_SESSION: Duration = Duration::from_secs(8 * 3600);
type App = Arc<Lab>;
type ApiResult = Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)>;

#[derive(Default, Serialize, Clone)]
struct View {
    connection: String,
    account: String,
    authorized_account: String,
    destination: String,
    call: String,
    message: String,
    sent_frames: u64,
    received_frames: u64,
    audible_frames: u64,
    started_at: u64,
    last_result: Option<CallResult>,
}
#[derive(Serialize, Deserialize, Clone)]
struct CallResult {
    started_at: u64,
    duration_seconds: u64,
    sent_frames: u64,
    received_frames: u64,
    audible_frames: u64,
    reason: String,
}
struct Lab {
    view: RwLock<View>,
    client: RwLock<Option<Arc<Client>>>,
    qr: RwLock<Option<(String, Instant)>>,
    active: Mutex<Option<CallHandle>>,
    busy: AtomicBool,
    cancel: AtomicBool,
    sent: AtomicU64,
    received: AtomicU64,
    audible: AtomicU64,
    sessions: Mutex<HashMap<String, Instant>>,
    login_attempts: Mutex<Vec<Instant>>,
    secret: String,
    data_dir: String,
    lab_phone: String,
    destination: String,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn random_token() -> String {
    let bytes: [u8; 32] = rand::rng().random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn equal(a: &str, b: &str) -> bool {
    let mut diff = a.len() ^ b.len();
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= (x ^ y) as usize;
    }
    diff == 0
}
fn error(status: StatusCode, message: &str) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({"message":message})))
}
async fn authorized(app: &Lab, headers: &HeaderMap, mutate: bool) -> bool {
    let cookie = headers
        .get("cookie")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let token = cookie
        .split(';')
        .filter_map(|s| s.trim().strip_prefix("lab_session="))
        .next()
        .unwrap_or("");
    if mutate && headers.get("x-lab-action").and_then(|h| h.to_str().ok()) != Some("1") {
        return false;
    }
    app.sessions
        .lock()
        .await
        .get(token)
        .is_some_and(|at| at.elapsed() < MAX_SESSION)
}
async fn status(State(app): State<App>, h: HeaderMap) -> ApiResult {
    if !authorized(&app, &h, false).await {
        return Err(error(
            StatusCode::UNAUTHORIZED,
            "Entre para acessar o laboratório.",
        ));
    }
    let mut v = app.view.read().await.clone();
    v.sent_frames = app.sent.load(Ordering::Relaxed);
    v.received_frames = app.received.load(Ordering::Relaxed);
    v.audible_frames = app.audible.load(Ordering::Relaxed);
    Ok(Json(serde_json::json!(v)))
}
#[derive(Deserialize)]
struct Login {
    password: String,
}
async fn login(State(app): State<App>, Form(form): Form<Login>) -> Response {
    let mut tries = app.login_attempts.lock().await;
    tries.retain(|t| t.elapsed() < Duration::from_secs(60));
    if tries.len() >= 10 {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            "Aguarde um minuto e tente novamente.",
        )
            .into_response();
    }
    tries.push(Instant::now());
    if !equal(form.password.trim(), &app.secret) {
        return (StatusCode::UNAUTHORIZED, "Senha incorreta.").into_response();
    }
    let token = random_token();
    let mut sessions = app.sessions.lock().await;
    sessions.retain(|_, t| t.elapsed() < MAX_SESSION);
    if sessions.len() >= 16 {
        sessions.clear();
    }
    sessions.insert(token.clone(), Instant::now());
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        "set-cookie",
        HeaderValue::from_str(&format!(
            "lab_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800"
        ))
        .unwrap(),
    );
    response
}
async fn logout(State(app): State<App>, h: HeaderMap) -> StatusCode {
    if !authorized(&app, &h, true).await {
        return StatusCode::UNAUTHORIZED;
    }
    let cookie = h.get("cookie").and_then(|v| v.to_str().ok()).unwrap_or("");
    if let Some(t) = cookie
        .split(';')
        .find_map(|s| s.trim().strip_prefix("lab_session="))
    {
        app.sessions.lock().await.remove(t);
    }
    StatusCode::NO_CONTENT
}
async fn qr(State(app): State<App>, h: HeaderMap) -> Response {
    if !authorized(&app, &h, false).await {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let qr = app.qr.read().await;
    let Some((value, until)) = qr.as_ref().filter(|(_, until)| *until > Instant::now()) else {
        return StatusCode::NO_CONTENT.into_response();
    };
    let _ = until;
    match qrcode::QrCode::new(value.as_bytes()) {
        Ok(code) => (
            [("content-type", "image/svg+xml")],
            code.render::<qrcode::render::svg::Color>()
                .min_dimensions(320, 320)
                .build(),
        )
            .into_response(),
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}
async fn call(State(app): State<App>, h: HeaderMap) -> ApiResult {
    if !authorized(&app, &h, true).await {
        return Err(error(
            StatusCode::UNAUTHORIZED,
            "Entre novamente para fazer o teste.",
        ));
    }
    let v = app.view.read().await;
    if v.connection != "connected" {
        return Err(error(
            StatusCode::CONFLICT,
            "Vincule o WhatsApp antes de ligar.",
        ));
    }
    if v.account != app.lab_phone {
        return Err(error(
            StatusCode::CONFLICT,
            "O número vinculado é diferente do laboratório autorizado. Confira a conta antes de ligar.",
        ));
    }
    drop(v);
    if app
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(error(
            StatusCode::CONFLICT,
            "Já existe um teste em andamento.",
        ));
    }
    app.cancel.store(false, Ordering::SeqCst);
    app.sent.store(0, Ordering::Relaxed);
    app.received.store(0, Ordering::Relaxed);
    app.audible.store(0, Ordering::Relaxed);
    {
        let mut v = app.view.write().await;
        v.call = "calling".into();
        v.message = "Ligando para o número autorizado…".into();
        v.started_at = now();
    }
    tokio::spawn(run_call(app));
    Ok(Json(serde_json::json!({"message":"Teste iniciado."})))
}
async fn terminate(app: &App, handle: &CallHandle) {
    let client = app.client.read().await.clone();
    if let Some(client) = client {
        let result = tokio::time::timeout(
            Duration::from_secs(4),
            client
                .voip()
                .terminate(handle.call_id(), &handle.peer_jid(), handle.call_creator()),
        )
        .await;
        if !matches!(result, Ok(Ok(_))) {
            handle.hangup().await;
        }
    } else {
        handle.hangup().await;
    }
}
async fn hangup(State(app): State<App>, h: HeaderMap) -> ApiResult {
    if !authorized(&app, &h, true).await {
        return Err(error(
            StatusCode::UNAUTHORIZED,
            "Entre novamente para encerrar o teste.",
        ));
    }
    app.cancel.store(true, Ordering::SeqCst);
    let handle = app.active.lock().await.clone();
    if let Some(handle) = handle {
        terminate(&app, &handle).await;
    }
    Ok(Json(serde_json::json!({"message":"Encerrando o teste…"})))
}
async fn run_call(app: App) {
    let started = Instant::now();
    let result = do_call(&app).await;
    let reason = match result {
        Ok(reason) => reason,
        Err(err) => {
            // Detailed errors stay only in restricted server logs. Never include pairing or session payloads.
            log::error!("Call setup failed: {err}");
            "Não foi possível completar a ligação. Verifique se o destino está no WhatsApp e tente novamente.".into()
        }
    };
    app.active.lock().await.take();
    let mut v = app.view.write().await;
    let result = CallResult {
        started_at: v.started_at,
        duration_seconds: started.elapsed().as_secs(),
        sent_frames: app.sent.load(Ordering::Relaxed),
        received_frames: app.received.load(Ordering::Relaxed),
        audible_frames: app.audible.load(Ordering::Relaxed),
        reason: reason.clone(),
    };
    v.call = "idle".into();
    v.message = reason;
    v.last_result = Some(result.clone());
    drop(v);
    // Overwrite a single bounded metadata file. No contacts, messages or audio recording are exported.
    if let Ok(bytes) = serde_json::to_vec_pretty(&result) {
        let path = format!("{}/last-test.json", app.data_dir);
        let tmp = format!("{path}.tmp");
        if tokio::fs::write(&tmp, bytes).await.is_ok() {
            let _ = tokio::fs::rename(tmp, path).await;
        }
    }
    app.busy.store(false, Ordering::SeqCst);
}
async fn do_call(app: &App) -> anyhow::Result<String> {
    let client = app
        .client
        .read()
        .await
        .clone()
        .ok_or_else(|| anyhow::anyhow!("Disconnected"))?;
    let peer: Jid = format!("{}@s.whatsapp.net", app.destination).parse()?;
    let mut fallback_decoder = whatsapp_rust::voip::audio::WaOpusDecoder::new()?;
    let (mic_tx, mic_rx) = async_channel::bounded(4);
    let (speaker_tx, speaker_rx) = async_channel::bounded::<Vec<i16>>(8);
    let (echo_tx, echo_rx) = async_channel::bounded::<Vec<i16>>(4);
    let media_app = app.clone();
    let receive_task = tokio::spawn(async move {
        while let Ok(frame) = speaker_rx.recv().await {
            media_app.received.fetch_add(1, Ordering::Relaxed);
            if frame.iter().any(|s| s.unsigned_abs() > 250) {
                media_app.audible.fetch_add(1, Ordering::Relaxed);
            }
            let _ = echo_tx.try_send(frame);
        }
    });
    let media_app = app.clone();
    let send_task = tokio::spawn(async move {
        let mut clock = tokio::time::interval(Duration::from_millis(60));
        clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut frame_index = 0usize;
        loop {
            clock.tick().await;
            if media_app.cancel.load(Ordering::SeqCst) {
                break;
            }
            let mut pcm = echo_rx.try_recv().unwrap_or_else(|_| vec![0; 960]);
            pcm.resize(960, 0);
            pcm.truncate(960);
            // A quiet 440 Hz cue for one second every six seconds; the receiver also hears their voice returned.
            for (i, sample) in pcm.iter_mut().enumerate() {
                let n = frame_index * 960 + i;
                let tone = if n % 96000 < 16000 {
                    (1800.0 * (std::f64::consts::TAU * 440.0 * n as f64 / 16000.0).sin()) as i16
                } else {
                    0
                };
                *sample = (*sample / 2).saturating_add(tone);
            }
            if mic_tx.send(pcm).await.is_err() {
                break;
            }
            media_app.sent.fetch_add(1, Ordering::Relaxed);
            frame_index += 1;
        }
    });
    // start() can wait for network negotiation; cancellation must not abandon a live call.
    let setup = tokio::time::timeout(
        Duration::from_secs(35),
        client.voip().call(&peer).audio(mic_rx, speaker_tx.clone()).start(),
    )
    .await;
    let handle = match setup {
        Ok(Ok(h)) => h,
        other => {
            receive_task.abort();
            send_task.abort();
            match other {
                Ok(Err(e)) => return Err(e.into()),
                _ => anyhow::bail!("Call setup timeout"),
            }
        }
    };
    *app.active.lock().await = Some(handle.clone());
    if app.cancel.load(Ordering::SeqCst) {
        terminate(app, &handle).await;
    }
    let events = handle.events();
    let ended = handle.wait_ended();
    tokio::pin!(ended);
    let limit = tokio::time::sleep(MAX_CALL);
    tokio::pin!(limit);
    let reason = loop {
        tokio::select! {
            _=&mut ended=>break if app.cancel.load(Ordering::SeqCst){"Teste encerrado."}else{"A ligação foi encerrada pelo destino ou pela conexão."}.to_string(),
            _=&mut limit=>{terminate(app,&handle).await;break "Teste concluído: limite de 90 segundos atingido.".into();},
            event=events.recv()=>match event {
                Ok(CallEvent::RelayAllocated)=>{let mut v=app.view.write().await;v.call="media_ready".into();v.message="Canal de áudio conectado. Atenda no destino e fale para testar o retorno da voz.".into();},
                Ok(CallEvent::RelayAllocateFailed(_)|CallEvent::RelayAllocateTimedOut)=>{terminate(app,&handle).await;break "Não foi possível abrir o áudio da ligação. Tente novamente.".into();},
                Ok(CallEvent::ForeignAudio(payload))=>{
                    match fallback_decoder.decode_mlow_escape(&payload) {
                        Ok(pcm)=>{let _=speaker_tx.try_send(pcm.to_vec());},
                        Err(_)=>log::warn!("Could not decode alternate audio frame"),
                    }
                },
                Ok(_)=>{},Err(_)=>break "Teste encerrado.".into()
            }
        }
    };
    receive_task.abort();
    send_task.abort();
    Ok(reason)
}
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    env_logger::init();
    let data_dir = std::env::var("DATA_DIR").unwrap_or("/data".into());
    let secret = tokio::fs::read_to_string(
        std::env::var("ADMIN_SECRET_FILE").unwrap_or("/run/secrets/lab-admin".into()),
    )
    .await?
    .trim()
    .to_owned();
    anyhow::ensure!(
        secret.len() >= 32,
        "Admin secret must have at least 32 characters"
    );
    let lab_phone = std::env::var("LAB_PHONE")?;
    let destination = std::env::var("TEST_DESTINATION")?;
    for phone in [&lab_phone, &destination] {
        anyhow::ensure!(
            (12..=13).contains(&phone.len())
                && phone.bytes().all(|c| c.is_ascii_digit())
                && phone.starts_with("55"),
            "Invalid authorized phone"
        );
    }
    anyhow::ensure!(
        lab_phone != destination,
        "Lab and test destination must differ"
    );
    let last_result = tokio::fs::read(format!("{data_dir}/last-test.json"))
        .await
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    let app = Arc::new(Lab {
        view: RwLock::new(View {
            connection: "starting".into(),
            call: "idle".into(),
            destination: destination.clone(),
            authorized_account: lab_phone.clone(),
            message: "Conectando ao WhatsApp…".into(),
            last_result,
            ..Default::default()
        }),
        client: RwLock::new(None),
        qr: RwLock::new(None),
        active: Mutex::new(None),
        busy: AtomicBool::new(false),
        cancel: AtomicBool::new(false),
        sent: AtomicU64::new(0),
        received: AtomicU64::new(0),
        audible: AtomicU64::new(0),
        sessions: Mutex::new(HashMap::new()),
        login_attempts: Mutex::new(Vec::new()),
        secret,
        data_dir: data_dir.clone(),
        lab_phone,
        destination,
    });
    let qr_app = app.clone();
    let event_app = app.clone();
    let store = SqliteStore::new(&format!("{data_dir}/whatsapp.db")).await?;
    let bot=Bot::builder().with_backend(store).skip_history_sync()
        .on_qr_code(move |code,timeout|{let app=qr_app.clone();async move{
            *app.qr.write().await=Some((code,Instant::now()+timeout));
            let mut v=app.view.write().await;v.connection="pairing".into();v.message="No WhatsApp do laboratório, abra Dispositivos conectados e escaneie o QR Code.".into();
        }})
        .on_event_for(&[EventKind::Connected,EventKind::Disconnected,EventKind::PairSuccess,EventKind::LoggedOut,EventKind::PairingQrCodesExhausted,EventKind::ClientOutdated],move |event,client|{let app=event_app.clone();async move{
            match &*event {
                Event::Connected(_)=>{
                    *app.client.write().await=Some(client.clone());*app.qr.write().await=None;
                    let mut v=app.view.write().await;v.account=client.pn().map(|j|j.user.to_string()).unwrap_or_default();v.connection="connected".into();v.message="WhatsApp conectado. Confira o número vinculado antes do teste.".into();
                },
                Event::PairSuccess(pair)=>{app.view.write().await.account=pair.id.user.to_string();},
                Event::Disconnected(_)=>{*app.client.write().await=None;let mut v=app.view.write().await;v.connection="reconnecting".into();v.message="Conexão interrompida. Reconectando…".into();},
                Event::LoggedOut(_)=>{*app.client.write().await=None;*app.qr.write().await=None;let mut v=app.view.write().await;v.connection="logged_out".into();v.account.clear();v.message="O aparelho foi desvinculado. Reinicie o laboratório para gerar outro QR Code.".into();},
                Event::PairingQrCodesExhausted(_)=>{*app.qr.write().await=None;let mut v=app.view.write().await;v.connection="expired".into();v.message="O tempo para vincular terminou. Reinicie o laboratório para gerar outro QR Code.".into();},
                Event::ClientOutdated(_)=>{app.view.write().await.message="A conexão precisa de uma atualização do laboratório.".into();},
                _=>{}
            }
        }}).build().await?;
    let mut bot_handle = bot.spawn();
    let router = Router::new()
        .route(
            "/",
            get(|| async { Html(include_str!("../ui/index.html")) }),
        )
        .route("/healthz", get(|| async { "ok" }))
        .route("/api/login", post(login))
        .route("/api/logout", post(logout))
        .route("/api/status", get(status))
        .route("/api/qr", get(qr))
        .route("/api/call", post(call))
        .route("/api/hangup", post(hangup))
        .layer(axum::middleware::map_response(
            |mut response: Response| async move {
                let h = response.headers_mut();
                h.insert("cache-control", HeaderValue::from_static("no-store"));
                h.insert(
                    "x-content-type-options",
                    HeaderValue::from_static("nosniff"),
                );
                h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
                h.insert("x-frame-options", HeaderValue::from_static("DENY"));
                response
            },
        ))
        .with_state(app.clone());
    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;
    log::info!(
        "Isolated WhatsApp lab ready on port 8080; outbound calls require an explicit authenticated action"
    );
    let stop = async move {
        let mut term =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
        tokio::select! {_ = tokio::signal::ctrl_c()=>{},_ = term.recv()=>{},_ = &mut bot_handle=>{}};
        app.cancel.store(true, Ordering::SeqCst);
        let handle = app.active.lock().await.clone();
        if let Some(h) = handle {
            terminate(&app, &h).await;
        }
        bot_handle.shutdown().await;
    };
    axum::serve(listener, router)
        .with_graceful_shutdown(stop)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> App {
        Arc::new(Lab {
            view: RwLock::new(View { connection: "pairing".into(), call: "idle".into(), ..Default::default() }),
            client: RwLock::new(None), qr: RwLock::new(None), active: Mutex::new(None),
            busy: AtomicBool::new(false), cancel: AtomicBool::new(false),
            sent: AtomicU64::new(0), received: AtomicU64::new(0), audible: AtomicU64::new(0),
            sessions: Mutex::new(HashMap::new()), login_attempts: Mutex::new(Vec::new()),
            secret: "unit-test-only-secret-with-32-chars".into(), data_dir: "/unused".into(),
            lab_phone: "550000000001".into(), destination: "550000000002".into(),
        })
    }

    async fn session(app: &App) -> HeaderMap {
        app.sessions.lock().await.insert("test-session".into(), Instant::now());
        let mut headers = HeaderMap::new();
        headers.insert("cookie", HeaderValue::from_static("lab_session=test-session"));
        headers
    }

    #[tokio::test]
    async fn access_requires_session_and_action_header_and_rejects_expiry() {
        let app = fixture();
        assert!(!authorized(&app, &HeaderMap::new(), false).await);
        let mut headers = session(&app).await;
        assert!(authorized(&app, &headers, false).await);
        assert!(!authorized(&app, &headers, true).await);
        headers.insert("x-lab-action", HeaderValue::from_static("1"));
        assert!(authorized(&app, &headers, true).await);
        app.sessions.lock().await.insert("test-session".into(), Instant::now() - MAX_SESSION - Duration::from_secs(1));
        assert!(!authorized(&app, &headers, false).await);
    }

    #[tokio::test]
    async fn calls_are_blocked_before_pairing_on_wrong_account_and_while_busy() {
        let app = fixture();
        let mut headers = session(&app).await;
        headers.insert("x-lab-action", HeaderValue::from_static("1"));
        assert_eq!(call(State(app.clone()), headers.clone()).await.unwrap_err().0, StatusCode::CONFLICT);
        { let mut v=app.view.write().await; v.connection="connected".into(); v.account="550000000099".into(); }
        assert_eq!(call(State(app.clone()), headers.clone()).await.unwrap_err().0, StatusCode::CONFLICT);
        assert!(!app.busy.load(Ordering::SeqCst));
        app.view.write().await.account=app.lab_phone.clone();
        app.busy.store(true,Ordering::SeqCst);
        assert_eq!(call(State(app.clone()), headers).await.unwrap_err().0, StatusCode::CONFLICT);
        assert_eq!(app.sent.load(Ordering::Relaxed),0);
        assert!(app.active.lock().await.is_none());
    }

    #[tokio::test]
    async fn login_rejects_invalid_key_and_limits_repeated_attempts() {
        let app=fixture();
        for _ in 0..10 {
            assert_eq!(login(State(app.clone()),Form(Login {password:"incorrect".into()})).await.status(),StatusCode::UNAUTHORIZED);
        }
        assert_eq!(login(State(app.clone()),Form(Login {password:app.secret.clone()})).await.status(),StatusCode::TOO_MANY_REQUESTS);
        assert!(app.sessions.lock().await.is_empty());
    }
}
