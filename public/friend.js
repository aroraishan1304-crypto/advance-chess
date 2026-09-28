(() => {
  const el = (tag, attrs = {}, text = "") => { const e = document.createElement(tag); Object.assign(e, attrs); if (text) e.textContent = text; return e; };
  const state = { socket:null, token:null, gameId:null, color:null, seq:-1, friendState:null, creating:false, reconnectTimer:null, clientClockOffsetMs:0 };
  let modal, nameInput, timeSelect, colorSelect, errorEl, statusEl, linkWrap, linkInput, joinBtn, createBtn;

  function addModal() {
    modal = el('div', { className:'friend-modal-backdrop', id:'friendModal' });
    const card = el('div', { className:'friend-modal' });
    card.innerHTML = `
      <h2>Play a Friend</h2>
      <p>Create a private live game or join an existing game link.</p>
      <div class="friend-row"><input id="friendName" maxlength="24" placeholder="Your name" value="Player"></div>
      <div class="friend-row"><select id="friendTime"><option value="60+0">1 + 0</option><option value="180+0">3 + 0</option><option value="180+2">3 + 2</option><option value="300+0">5 + 0</option><option value="300+3">5 + 3</option><option value="600+0" selected>10 + 0</option><option value="600+5">10 + 5</option><option value="900+10">15 + 10</option><option value="1800+0">30 + 0</option><option value="0+0">Unlimited</option></select><select id="friendColor"><option value="random">Random color</option><option value="w">White</option><option value="b">Black</option></select></div>
      <div class="friend-row"><input id="friendJoin" placeholder="Paste a game link or game code"></div>
      <div class="friend-error" id="friendError"></div>
      <div class="friend-status" id="friendStatus">Connected to the website. Ready.</div>
      <div id="friendLinkWrap" hidden></div>
      <div class="friend-actions"><button class="friend-btn secondary" id="friendClose">Close</button><button class="friend-btn secondary" id="friendJoinBtn">Join Game</button><button class="friend-btn primary" id="friendCreateBtn">Create Game</button></div>`;
    modal.append(card); document.body.append(modal);
    nameInput = modal.querySelector('#friendName'); timeSelect = modal.querySelector('#friendTime'); colorSelect = modal.querySelector('#friendColor'); errorEl = modal.querySelector('#friendError'); statusEl = modal.querySelector('#friendStatus'); linkWrap = modal.querySelector('#friendLinkWrap'); joinBtn = modal.querySelector('#friendJoinBtn'); createBtn = modal.querySelector('#friendCreateBtn');
    modal.querySelector('#friendClose').onclick = () => { modal.classList.remove('show'); };
    createBtn.onclick = createGame; joinBtn.onclick = joinGame;
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('show'); });
  }

  function openModal(prefillGame = '') { if (!modal) addModal(); errorEl.textContent=''; statusEl.textContent='Create a game and send the link to your friend.'; if (prefillGame) modal.querySelector('#friendJoin').value=prefillGame; modal.classList.add('show'); }
  function showError(message){ errorEl.textContent=message; }
  function parseTime(value){ const [s,i]=String(value).split('+').map(Number); return { unlimited:s===0, initialSeconds:s||0, incrementSeconds:i||0 }; }
  function uuid(){ return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
  function gameCodeFromInput(value){ const raw=String(value||'').trim(); const m=raw.match(/[?&]friend=([A-Z0-9]{8,16})/i); return (m?m[1]:raw).toUpperCase(); }

  async function createGame(){
    if(state.creating) return; state.creating=true; createBtn.disabled=true; showError(''); statusEl.textContent='Creating game…';
    try{
      const timeControl=parseTime(timeSelect.value); const r=await fetch('/api/games',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:nameInput.value,timeControl,colorPreference:colorSelect.value})}); const data=await r.json(); if(!r.ok) throw new Error(data.message||data.error||'Could not create game');
      state.gameId=data.gameId; state.token=data.playerToken; state.color=null; localStorage.setItem(`advancedChessToken:${data.gameId}`, data.playerToken);
      const url=`${location.origin}${data.sharePath}`; linkWrap.hidden=false; linkWrap.innerHTML=`<div class="friend-badge">Game created</div><div class="friend-share">${url}</div><div class="friend-link"><input readonly value="${url}"><button class="friend-btn secondary" id="friendCopy">Copy</button></div>`; linkWrap.querySelector('#friendCopy').onclick=()=>navigator.clipboard?.writeText(url);
      statusEl.textContent='Waiting for your friend to join…'; modal.classList.remove('show'); enterFriendGame(state.gameId,state.token);
    }catch(e){ showError(e.message); }
    finally{ state.creating=false; createBtn.disabled=false; }
  }

  async function joinGame(){
    const code=gameCodeFromInput(modal.querySelector('#friendJoin').value);
    if(!/^[A-Z0-9]{8,16}$/.test(code)) return showError('Enter a valid game link or code.');
    joinBtn.disabled=true; showError('');
    try{
      const r=await fetch('/api/games/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({gameId:code,name:nameInput.value})});
      const data=await r.json(); if(!r.ok) throw new Error(data.message||data.error||'Could not join game');
      localStorage.setItem(`advancedChessToken:${data.gameId}`,data.playerToken);
      modal.classList.remove('show'); enterFriendGame(data.gameId,data.playerToken);
    }catch(e){ showError(e.message); } finally { joinBtn.disabled=false; }
  }

  function connect(gameId, token){
    if(state.socket){ try{state.socket.close();}catch{} }
    state.gameId=gameId; state.token=token || state.token; const proto=location.protocol==='https:'?'wss':'ws'; const ws=new WebSocket(`${proto}://${location.host}/ws/${encodeURIComponent(gameId)}`); state.socket=ws;
    ws.onopen=()=>{ ws.send(JSON.stringify({protocol:1,type:'hello',token:state.token||'',name:(nameInput?.value||'Player').trim().slice(0,24)})); };
    ws.onmessage=e=>handleMessage(JSON.parse(e.data));
    ws.onclose=()=>{ if(document.body.dataset.friendMode==='1' && state.token){ statusEl&&(statusEl.textContent='Connection lost. Reconnecting…'); clearTimeout(state.reconnectTimer); state.reconnectTimer=setTimeout(()=>connect(state.gameId,state.token),1200); } };
    ws.onerror=()=>{};
  }

  function enterFriendGame(gameId, token){ document.body.dataset.friendMode='1'; window.friendMode=true; const saved=localStorage.getItem(`advancedChessToken:${gameId}`); connect(gameId,token||saved); }
  function send(type, payload={}){ if(!state.socket || state.socket.readyState!==WebSocket.OPEN) return false; state.socket.send(JSON.stringify({protocol:1,type,commandId:uuid(),...payload})); return true; }

  function handleMessage(msg){
    if(msg.type==='welcome'){ state.color=msg.color; state.seq=msg.state.seq; state.friendState=msg.state; window.friendApplyState?.(msg.state,msg.color); renderClockLoop(); return; }
    if(msg.type==='state'){ state.seq=msg.state.seq; state.friendState=msg.state; window.friendApplyState?.(msg.state,state.color); return; }
    if(msg.type==='move_rejected'){ showFriendToast(msg.code==='state_out_of_date'?'Game updated — try your move again.':`Move rejected: ${msg.code}`); if(msg.state){state.friendState=msg.state; window.friendApplyState?.(msg.state,state.color);} return; }
    if(msg.type==='error'){ showFriendToast(msg.code||'Server error'); }
    if(msg.type==='pong'){ state.clientClockOffsetMs=Date.now()-msg.serverNow; }
  }

  function showFriendToast(text){ if(window.showToast){ window.showToast(text); } else console.warn(text); }

  window.friendSubmitMove=(move)=>send('move',{baseSeq:state.seq,from:move.from,to:move.to,promotion:move.promotion||null});
  window.friendResign=()=>send('resign',{baseSeq:state.seq});
  window.friendOfferDraw=()=>send('offer_draw',{baseSeq:state.seq});
  window.friendAcceptDraw=()=>send('accept_draw',{baseSeq:state.seq});
  window.friendDeclineDraw=()=>send('decline_draw',{baseSeq:state.seq});
  window.friendClaimDraw=(kind)=>send('claim_draw',{baseSeq:state.seq,kind});
  window.friendRenderClocks=()=>{
    const fs=state.friendState; if(!fs) return; const now=Date.now()-state.clientClockOffsetMs; let w=fs.clocks.white,b=fs.clocks.black;
    if(fs.status==='active'&&!fs.timeUnlimited){ const elapsed=Math.max(0,now-fs.serverNow); if(fs.turn==='w') w=Math.max(0,w-elapsed); else b=Math.max(0,b-elapsed); }
    window.friendClockValues={w:Math.floor(w),b:Math.floor(b)}; if(window.friendUpdateClockElements) window.friendUpdateClockElements(window.friendClockValues,fs);
  };
  function renderClockLoop(){ clearInterval(state.clockTimer); state.clockTimer=setInterval(()=>window.friendRenderClocks?.(),100); window.friendRenderClocks?.(); }

  window.friendExit=()=>{ try{state.socket?.close(1000,'left_game');}catch{} state.socket=null; clearInterval(state.clockTimer); state.friendState=null; document.body.dataset.friendMode='0'; window.friendMode=false; };

  document.addEventListener('DOMContentLoaded',()=>{
    addModal();
    document.querySelectorAll('.home-card[data-friend-entry]').forEach(b=>b.addEventListener('click',()=>openModal()));
    const params=new URLSearchParams(location.search); const g=params.get('friend'); if(g){ const saved=localStorage.getItem(`advancedChessToken:${g}`); if(saved) enterFriendGame(g,saved); else openModal(g); }
  });
})();
