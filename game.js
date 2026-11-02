// AF.point Metronome — progress, XP, streaks, quests and achievements.
// Everything lives in localStorage on this device; the metronome feeds it practice deltas.
(function(){
const KEY='afp.progress.v1';
const DAY_CUT=4;          // practice before 4 am counts toward the previous day
const STREAK_MIN=600;     // seconds of practice for a day to count toward the streak
const LV_COST=220, SKILL_COST=60;

const SUB_NAMES=['Четверти','Восьмые','Триоли','Шестнадцатые','Квинтоли','Секстоли','Септоли','32-е'];
const SKILLS=[...SUB_NAMES.map((n,i)=>['sub'+(i+1),n]),['rud','Рудименты'],['gap','Тишина'],['ladder','Лесенка']];
const SKILL_NAME=Object.fromEntries(SKILLS);

const RANKS=[[1,'Табуреточник'],[3,'Стучит по столу'],[6,'Гаражный'],[10,'Репбаза'],[15,'Кавер-бэнд'],[20,'Клубный'],[27,'Сессионщик'],[35,'Грув-машина'],[45,'Человек-метроном']];

const pad=n=>String(n).padStart(2,'0');
const dkey=t=>t.getFullYear()+'-'+pad(t.getMonth()+1)+'-'+pad(t.getDate());
const parse=k=>{const [y,m,d]=k.split('-').map(Number);return new Date(y,m-1,d)};
const dayOf=ts=>dkey(new Date(ts-DAY_CUT*3600e3));
const addDays=(k,n)=>{const t=parse(k);return dkey(new Date(t.getFullYear(),t.getMonth(),t.getDate()+n))};
const weekOf=k=>{const t=parse(k);const wd=(t.getDay()+6)%7;return dkey(new Date(t.getFullYear(),t.getMonth(),t.getDate()-wd))};

function empty(){ return {v:1,created:Date.now(),xp:0,total:0,skills:{},secs:{},days:{},records:{},records2:{},ruds:{},counters:{},longest:0,bestStreak:0,ach:{},medals:{},questsDone:{},daily:null,today:null,log:[]}; }
function load(){ try{ const raw=localStorage.getItem(KEY); if(raw){const d=JSON.parse(raw); if(d&&d.v===1)return Object.assign(empty(),d)} }catch(e){} return empty(); }
function save(d){ try{ localStorage.setItem(KEY,JSON.stringify(d)); return true }catch(e){ return false } }

// Level n -> n+1 costs cost*n XP.
function levelOf(xp,cost){ let lv=1,left=xp; while(left>=cost*lv){left-=cost*lv;lv++} const need=cost*lv; return {lv,into:Math.floor(left),need,pct:left/need}; }
const level=xp=>levelOf(xp,LV_COST);
const skillLevel=xp=>levelOf(xp||0,SKILL_COST);
function rankOf(lv){ let i=0; RANKS.forEach((r,j)=>{if(lv>=r[0])i=j}); const next=RANKS[i+1]; return {tier:i,title:RANKS[i][1],next:next?{lv:next[0],title:next[1]}:null}; }

// XP per second of play: 10 XP a minute, more for harder or record-pushing work.
function rate(ctx,d){
  let m=1;
  if(ctx.gap)m*=1.5;
  if(ctx.sub===3||ctx.sub===5||ctx.sub===7)m*=1.2;
  if(ctx.ladder)m*=1.2;
  const rec=d.records[ctx.sub];
  if(rec){ if(ctx.bpm>rec)m*=1.5; else if(ctx.bpm>=rec*0.9)m*=1.3; }
  return 10/60*m;
}

function streak(d,today){
  const ok=k=>(d.days[k]||0)>=STREAK_MIN;
  const keys=Object.keys(d.days).sort(); const thisWeek=weekOf(today);
  if(!keys.length)return {cur:0,todayDone:false,freezeLeft:true};
  let k=ok(today)?today:addDays(today,-1),cur=0;const used={};
  // One missed day per calendar week is forgiven (the weekly "freeze").
  while(k>=keys[0]){ if(ok(k))cur++; else { const w=weekOf(k); if(used[w])break; used[w]=1; } k=addDays(k,-1); }
  return {cur,todayDone:ok(today),freezeLeft:!used[thisWeek]};
}

// ---------- daily quests ----------
function seeded(s){ let h=2166136261; for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619); return ()=>{h^=h<<13;h^=h>>>17;h^=h<<5;return ((h>>>0)%100000)/100000}; }
const SUB_QUEST=['Медленно — значит чисто','Восьмёрочная разминка','Триольный дозор','Шестнашки на прокачку','Квинтольная лихорадка','Секстольная мельница','Тайна септолей','Тридцать вторая передача'];
function makeDaily(d,today){
  const rnd=seeded(today);
  const weak=[1,2,3,4,5,6,7,8].map(n=>({n,x:(d.skills['sub'+n]||0)+rnd()*30})).sort((a,b)=>a.x-b.x);
  const s1=weak[Math.floor(rnd()*3)].n;
  const tm=[15,20,30][Math.floor(rnd()*3)];
  const list=[{id:'total',k:'total',mins:tm,title:'Норма дня',desc:`Сыграть ${tm} минут за день`,xp:tm*4}];
  list.push({id:'sub'+s1,k:'skill',skill:'sub'+s1,mins:s1>=5?5:8,title:SUB_QUEST[s1-1],desc:`${s1>=5?5:8} минут: ${SUB_NAMES[s1-1].toLowerCase()}`,xp:s1>=5?90:80});
  const extra=[
    {id:'gap',k:'skill',skill:'gap',mins:5,title:'Тишина в библиотеке',desc:'5 минут с включённым Gap Click',xp:90},
    {id:'rud',k:'skill',skill:'rud',mins:8,title:'Рудиментарный минимум',desc:'8 минут любых рудиментов',xp:80},
    {id:'ladder',k:'ladder',n:1,title:'Вверх по лестнице',desc:'Пройти лесенку дольностей целиком',xp:100},
    {id:'bladder',k:'bladder',n:1,title:'Разгон',desc:'Дойти до цели в BPM-лесенке',xp:100}];
  const s2=weak.find(w=>w.n!==s1&&rnd()<0.5)||weak.find(w=>w.n!==s1);
  extra.push({id:'sub'+s2.n,k:'skill',skill:'sub'+s2.n,mins:5,title:SUB_QUEST[s2.n-1],desc:`5 минут: ${SUB_NAMES[s2.n-1].toLowerCase()}`,xp:70});
  list.push(extra[Math.floor(rnd()*extra.length)]);
  return {date:today,list:list.map(q=>({...q,done:false})),all:false};
}
function rollDay(d,today){
  if(!d.today||d.today.date!==today)d.today={date:today,secs:0,by:{},ladder:0,bladder:0};
  if(!d.daily||d.daily.date!==today)d.daily=makeDaily(d,today);
}
function dailyProgress(q,d){
  const t=d.today||{secs:0,by:{}};
  if(q.k==='total')return Math.min(1,t.secs/60/q.mins);
  if(q.k==='skill')return Math.min(1,(t.by[q.skill]||0)/60/q.mins);
  return Math.min(1,(t[q.k]||0)/q.n);
}

// ---------- pickable quests and challenges ----------
const QUESTS=[
  {id:'q-trip-para',title:'Тройной парадидл',desc:'Single Paradiddle на триолях — акцент гуляет по долям.',sub:3,rud:'Single Paradiddle',bpm:80,mins:5,xp:150},
  {id:'q-quint',title:'Квинтольная лихорадка',desc:'Ровные квинтоли без рудимента. Считай «1-2-3-4-5».',sub:5,bpm:70,mins:5,xp:150},
  {id:'q-sext-pdd',title:'Секстольная мельница',desc:'Paradiddle-diddle на секстолях.',sub:6,rud:'Paradiddle-diddle',bpm:75,mins:5,xp:150},
  {id:'q-sept',title:'Тайна септолей',desc:'Семь нот на долю. Медленно и честно.',sub:7,bpm:60,mins:4,xp:160},
  {id:'q-dbl',title:'Дабл-трабл',desc:'Двойки на шестнадцатых, ровно с обеих рук.',sub:4,rud:'Double Stroke Open Roll',bpm:100,mins:5,xp:140},
  {id:'q-flamtap',title:'Флэм-патруль',desc:'Flam Tap на шестнадцатых.',sub:4,rud:'Flam Tap',bpm:80,mins:4,xp:130},
  {id:'q-swiss',title:'Швейцарский нож',desc:'Swiss Army Triplet на триолях.',sub:3,rud:'Swiss Army Triplet',bpm:90,mins:4,xp:140},
  {id:'q-rata',title:'Рататуй',desc:'Single Ratamacue на шестнадцатых.',sub:4,rud:'Single Ratamacue',bpm:70,mins:4,xp:140},
  {id:'q-gap',title:'Тишина в библиотеке',desc:'Восьмые, Gap: 2 такта клик / 2 тишина.',sub:2,bpm:90,gap:{on:true,click:2,gap:2,mode:'fixed'},mins:5,xp:160},
  {id:'q-gap-grow',title:'Слепой полёт',desc:'Шестнадцатые, тишина растёт до 4 тактов.',sub:4,bpm:80,gap:{on:true,click:2,gap:4,mode:'grow'},mins:5,xp:180},
  {id:'q-single',title:'Марафон шестнадцатых',desc:'Single Stroke Roll на 100. Десять минут без остановки.',sub:4,rud:'Single Stroke Roll',bpm:100,mins:10,xp:260},
  {id:'q-32',title:'Тридцать вторые на разогрев',desc:'Single Stroke 32-е в спокойном темпе.',sub:8,rud:'Single Stroke 32-е',bpm:55,mins:3,xp:120}
];
const MEDALS=['Бронза','Серебро','Золото','Платина'];
const CHALLENGES=[
  {id:'c-ladder',title:'Лесенка дольностей',desc:'1/4 → 32-е → обратно, по 2 такта на ступень. Ни одной запинки.',ladder:{on:true,inc:[1,2,3,4,5,6,7,8],bars:2,dir:'updown'},tiers:[60,80,100,120],xp:[200,300,450,650]},
  {id:'c-ladder-gap',title:'Лесенка в темноте',desc:'1/4 → секстоли → обратно, Gap: такт клик / такт тишина.',ladder:{on:true,inc:[1,2,3,4,5,6],bars:2,dir:'updown'},gap:{on:true,click:1,gap:1,mode:'fixed'},tiers:[50,60,70,80],xp:[250,350,500,700]},
  {id:'c-bpm16',title:'Лестница в небо',desc:'Шестнадцатые: старт на 40 ниже цели, +5 BPM каждые 4 такта.',sub:4,bladder:{on:true,step:5,every:4,end:'hold'},tiers:[120,140,160,180],xp:[200,300,450,650]},
  {id:'c-bpm3',title:'Триольный разгон',desc:'Триоли: старт на 40 ниже цели, +5 BPM каждые 4 такта.',sub:3,bladder:{on:true,step:5,every:4,end:'hold'},tiers:[110,130,150,170],xp:[200,300,450,650]}
];

// ---------- achievements ----------
let META={pas:[],jd:[]};
const tot=d=>d.total||0, sec=(d,k)=>d.secs[k]||0, cnt=(d,k)=>d.counters[k]||0;
const ACH=[
  ['first10','Первая кровь','10 минут за метрономом',d=>tot(d)>=600],
  ['hour1','Разогрелся','1 час за метрономом',d=>tot(d)>=3600],
  ['h10','Мозоли','10 часов за метрономом',d=>tot(d)>=36000],
  ['h50','Полтинник','50 часов за метрономом',d=>tot(d)>=180000],
  ['h100','Сотка','100 часов за метрономом',d=>tot(d)>=360000],
  ['marathon','Марафонец','Сессия 60 минут без остановки',d=>d.longest>=3600],
  ['night','Ночная смена','10 минут игры после полуночи',d=>cnt(d,'night')>=600],
  ['early','Жаворонок','Поиграть с 5 до 8 утра',d=>cnt(d,'morning')>=300,1],
  ['trip','Триольный барон','1 час триолей',d=>sec(d,'sub3')>=3600],
  ['quint','Квинтолевод','1 час квинтолей',d=>sec(d,'sub5')>=3600],
  ['sext','Секстольный маньяк','1 час секстолей',d=>sec(d,'sub6')>=3600],
  ['sept','Септольный ниндзя','30 минут септолей',d=>sec(d,'sub7')>=1800],
  ['all8','Полный набор','Каждая дольность — хотя бы 5 минут',d=>[1,2,3,4,5,6,7,8].every(n=>sec(d,'sub'+n)>=300)],
  ['t32','Тридцать вторая передача','32-е на 100+ BPM минуту подряд',d=>(d.records[8]||0)>=100],
  ['meat','Мясорубка','Шестнадцатые на 200+ BPM две минуты подряд',d=>(d.records2[4]||0)>=200],
  ['gap30','Тишина — тоже музыка','30 минут в Gap Click',d=>sec(d,'gap')>=1800],
  ['gap3h','Внутренние часы','3 часа в Gap Click',d=>sec(d,'gap')>=10800],
  ['rud10','Коллекционер','10 разных рудиментов (от минуты каждый)',d=>Object.values(d.ruds).filter(s=>s>=60).length>=10],
  ['pas40','Все 40','Каждый из 40 рудиментов PAS (от минуты каждый)',d=>META.pas.length>0&&META.pas.every(n=>(d.ruds[n]||0)>=60)],
  ['jd','Ученик JD','Все упражнения JD BECK (от минуты каждое)',d=>META.jd.length>0&&META.jd.every(n=>(d.ruds[n]||0)>=60),1],
  ['lad1','Первая ступень','Пройти лесенку дольностей',d=>cnt(d,'ladder')>=1],
  ['lad10','Альпинист','10 проходов лесенки дольностей',d=>cnt(d,'ladder')>=10],
  ['blad1','Газ в пол','Дойти до цели в BPM-лесенке',d=>cnt(d,'bladder')>=1],
  ['s3','Не случайность','Стрик 3 дня',d=>d.bestStreak>=3],
  ['s7','Неделя без пропусков','Стрик 7 дней',d=>d.bestStreak>=7],
  ['s30','Привычка','Стрик 30 дней',d=>d.bestStreak>=30],
  ['s100','Железная дисциплина','Стрик 100 дней',d=>d.bestStreak>=100],
  ['quest1','Взял квест','Завершить первый квест',d=>cnt(d,'quests')>=1],
  ['quest25','Квестоман','Завершить 25 квестов',d=>cnt(d,'quests')>=25],
  ['daily3','Хет-трик','Закрыть все 3 дневных квеста за день',d=>cnt(d,'dailyAll')>=1],
  ['gold','Чистюля','Испытание на золото',d=>Object.values(d.medals).some(m=>m>=2)],
  ['plat','Платина','Испытание на платину',d=>Object.values(d.medals).some(m=>m>=3),1],
  ['lv10','Двузначный','Дойти до 10 уровня',d=>level(d.xp).lv>=10],
  ['lv25','Ветеран','Дойти до 25 уровня',d=>level(d.xp).lv>=25],
  ['beat','Выше головы','Побить свой рекорд темпа',d=>cnt(d,'recBeats')>=1,1],
  ['slow','Зачем?','Две минуты на 25 BPM и ниже',d=>cnt(d,'slow')>=120,1],
  ['max','Предел','300 BPM минуту подряд',d=>Object.values(d.records).some(b=>b>=300),1]
].map(([id,title,desc,test,hidden])=>({id,title,desc,test,hidden:!!hidden}));
const ACH_XP=50;

function checkAch(d,ev,now){
  let more=true;
  while(more){ more=false;
    for(const a of ACH){ if(d.ach[a.id]||!a.test(d))continue; d.ach[a.id]=now; d.xp+=ACH_XP; ev.xp+=ACH_XP; ev.ach.push({id:a.id,title:a.title}); more=true; }
  }
}

// Apply a practice delta (and any bonus XP) to the profile. Returns what changed, for the toast.
// x = {xp, total, skills:{k:xp}, secs:{k:s}, ruds:{name:s}, counters:{k:n}, rec:{sub:bpm}, rec2:{sub:bpm}, longest, bonus}
function commit(d,x,now){
  now=now||Date.now(); const today=dayOf(now); rollDay(d,today);
  const ev={xp:0,lvUp:null,skillUps:[],records:[],ach:[],daily:[]};
  const lv0=level(d.xp).lv, sk0={}; SKILLS.forEach(([k])=>sk0[k]=skillLevel(d.skills[k]).lv);
  const gain=(x.xp||0)+(x.bonus||0); d.xp+=gain; ev.xp+=gain;
  for(const k in x.skills||{})d.skills[k]=(d.skills[k]||0)+x.skills[k];
  for(const k in x.secs||{}){d.secs[k]=(d.secs[k]||0)+x.secs[k];d.today.by[k]=(d.today.by[k]||0)+x.secs[k]}
  for(const k in x.ruds||{})d.ruds[k]=(d.ruds[k]||0)+x.ruds[k];
  for(const k in x.counters||{})d.counters[k]=(d.counters[k]||0)+x.counters[k];
  if(x.counters){d.today.ladder+=x.counters.ladder||0;d.today.bladder+=x.counters.bladder||0}
  if(x.total){d.total+=x.total;d.days[today]=(d.days[today]||0)+x.total;d.today.secs+=x.total}
  for(const s in x.rec||{}){const b=x.rec[s],old=d.records[s]||0;if(b>old){if(old){d.counters.recBeats=(d.counters.recBeats||0)+1;ev.records.push({sub:+s,bpm:b,name:SUB_NAMES[s-1]})}d.records[s]=b}}
  for(const s in x.rec2||{})d.records2[s]=Math.max(d.records2[s]||0,x.rec2[s]);
  if(x.longest)d.longest=Math.max(d.longest,x.longest);
  const daily=d.daily;
  daily.list.forEach(q=>{ if(!q.done&&dailyProgress(q,d)>=1){q.done=true;d.xp+=q.xp;ev.xp+=q.xp;ev.daily.push({title:q.title,xp:q.xp})} });
  if(!daily.all&&daily.list.every(q=>q.done)){daily.all=true;d.counters.dailyAll=(d.counters.dailyAll||0)+1;d.xp+=50;ev.xp+=50;ev.daily.push({title:'Все три за день — бонус',xp:50})}
  d.bestStreak=Math.max(d.bestStreak,streak(d,today).cur);
  checkAch(d,ev,now);
  const lv1=level(d.xp).lv; if(lv1>lv0){const r0=rankOf(lv0),r1=rankOf(lv1);ev.lvUp={lv:lv1,rank:r1.tier!==r0.tier?r1.title:null}}
  SKILLS.forEach(([k,name])=>{const l=skillLevel(d.skills[k]).lv;if(l>sk0[k])ev.skillUps.push({k,name,lv:l})});
  return ev;
}

// Finished a pickable quest or challenge. clean = honest self-check.
function finishQuest(d,q,clean,now){
  now=now||Date.now(); let bonus=0;
  if(q.kind==='challenge'){ if(clean){bonus=q.xp; d.medals[q.id]=Math.max(d.medals[q.id]??-1,q.tier)} }
  else bonus=clean?q.xp:Math.round(q.xp/2);
  if(clean||q.kind!=='challenge'){ d.questsDone[q.id]=(d.questsDone[q.id]||0)+1; }
  const ev=commit(d,{bonus,counters:clean||q.kind!=='challenge'?{quests:1}:{}},now);
  return ev;
}

function logSession(d,s){ d.log.unshift(s); d.log=d.log.slice(0,30); }

function mergeEv(a,b){ if(!a)return b; return {xp:a.xp+b.xp,lvUp:b.lvUp||a.lvUp,skillUps:[...a.skillUps.filter(u=>!b.skillUps.some(v=>v.k===u.k)),...b.skillUps],records:[...a.records.filter(r=>!b.records.some(v=>v.sub===r.sub)),...b.records],ach:[...a.ach,...b.ach],daily:[...a.daily,...b.daily]}; }

window.AFG={KEY,DAY_CUT,STREAK_MIN,SUB_NAMES,SKILLS,SKILL_NAME,RANKS,QUESTS,CHALLENGES,MEDALS,ACH,ACH_XP,
  load,save,empty,level,skillLevel,rankOf,rate,streak,dayOf,addDays,weekOf,rollDay,dailyProgress,commit,finishQuest,logSession,mergeEv,
  setMeta:m=>{META=m}};
})();
