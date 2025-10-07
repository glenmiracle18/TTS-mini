chrome.runtime.onMessage.addListener((e,n,r)=>{e.type=="PING"&&r({ok:!0})});
