#!/usr/bin/env python3
"""Local-only preview: writes sites/canes/app/preview.html with mocked API data for one week."""
import json, sys
src = open("scripts/build-content.py").read().split("if __name__")[0]
ns = {}; exec(src, ns)
cid, wk, out = ns["payloads"](sys.argv[1])
html = open("sites/canes/app/index.html").read()
inject = """<script>
localStorage.setItem('wsp_token','preview'); localStorage.setItem('wsp_student', JSON.stringify({id:1,first_name:'Maya',avatar:'bolt'}));
const MOCK=%s; const realFetch=window.fetch;
window.fetch=async(url,opts={})=>{const u=String(url);const J=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'Content-Type':'application/json'}});
 if(u.includes('/api/auth'))return J({students:[{id:1,first_name:'Maya',avatar:'bolt'}]});
 if(u.includes('/api/library'))return J({library:[{classId:'%s',title:'Preview class',gradeBand:'K–2',heroImage:'/assets/art/canes-storms-101.jpg',schoolId:'canes',nextUnlock:'2027-01-11',lessons:[{id:'1',position:%d,title:'Week %d preview',durationMin:20,unlocked:true}]}]});
 if(u.includes('/api/content'))return J({content:MOCK});
 if(u.includes('/api/video-token'))return J({error:'Video publishes with the lesson'},404);
 if(u.includes('/api/'))return J({officeHours:[],documents:[],notices:[]});
 return realFetch(url,opts);};
</script>
""" % (json.dumps(out), cid, wk, wk)
open("sites/canes/app/preview.html", "w").write(html.replace('<script src="app-engine.js"></script>', inject + '<script src="app-engine.js"></script>'))
print("preview written")
