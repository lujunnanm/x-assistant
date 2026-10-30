(()=>{
 globalThis.createInteractionGate=({isRunning,stop,start,onPaused})=>{
  let revision=0;
  return {
   cancel(){revision++;},
   async pause(){const token={revision,wasRunning:isRunning()};if(token.wasRunning){await stop();onPaused?.();}return token;},
   async resume(token){if(token?.wasRunning&&token.revision===revision&&!isRunning()){await start();return true;}return false;}
  };
 };
})();
