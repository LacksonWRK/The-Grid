const fs=require('fs'),path=require('path');
module.exports=function(){const src=fs.readFileSync(path.join(__dirname,'../src/core.js'),'utf8');return new Function(src)();};
