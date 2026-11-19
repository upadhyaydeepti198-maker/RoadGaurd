# RoadGuard AI Pro - Smart Road Safety System (v12)

Photo ya live camera se potholes, cracks aur damaged surface detect karta hai, beep + voice warning deta hai, aur ab **GPS map, hotspots, export aur report** bhi deta hai.

## v12 mein naya
- **Report to authority**: damage wali har photo / history entry par "Report to authority" button. Photo, location (Google Maps link), time, damage type aur severity ke saath Hindi + English complaint ban jaati hai. **Share** (WhatsApp / Gmail, photo ke saath), **WhatsApp**, **Email**, **Copy**, **Save photo**, **Print / PDF** se bhejo. Nagar Nigam / PWD ka email ya WhatsApp number ek baar daalo, device mein yaad rehta hai
- **Insights > Complaint for top hotspots**: sabse risky jagahon ki ek complaint, sabke map link ke saath
- **Live screen par "Report last hazard"** button
- **Paani wale gaddhe par "dhire chalo"**: paani bhara gaddha mile to banner mein "WATER-FILLED POTHOLES" aur voice (English + Hindi) mein "There is water on the road. Please slow down." / "सड़क पर पानी भरा है। कृपया धीरे चलिए।"
- **Rain mode** (Live screen ya Settings): sensitivity +15, minimum confidence -5 aur har damage warning ke saath "Rain mode is on. Drive slowly." Dhyan rahe: zyada sensitive hone se jhoothi alarm thodi badh sakti hain
- Photo WhatsApp / Email link se apne aap attach nahi hoti; photo ke saath bhejna ho to **Share** dabao ya photo save karke attach karo
- Report mein sirf wahi hota hai jo app ne detect kiya; authority ko bhejne se pehle jagah par ek baar check kar lo

## v11 mein naya
- **Photo ki asli location**: gallery photo ke andar jo GPS (EXIF) hota hai wo padhi jati hai, yani photo jahan li gayi thi wahi location lagti hai (ghar se li to ghar, road se li to road). Agar photo mein GPS nahi hai to aapki abhi ki position use hoti hai (Settings mein band bhi kar sakte ho). WhatsApp se aayi photo mein GPS hata diya jata hai, isliye Document ki tarah bhejo ya cable se copy karo.
- **Live monitoring GPS status**: live screen par dikhta hai "GPS 28.61, 77.20 (+-12 m)", ya "searching" / "blocked"
- **Trained AI model upload**: Settings > Trained AI model > Choose .onnx. Ek baar chuno, device mein yaad rehta hai (redeploy nahi chahiye). Pehli baar internet chahiye (ONNX runtime ke liye) jab tak `lib/` mein runtime na rakha ho.

## v10 mein naya (Pro upgrade)
- **Insights tab**: scans, damage by type, severity, last 7 days chart, offline damage map, risk-ranked hotspots
- **GPS tagging**: live monitoring aur camera photos ke saath location save hoti hai (sirf phone mein, upload nahi)
- **Export**: CSV, GeoJSON (QGIS / Google My Maps / geojson.io), aur printable PDF **Road Condition Report**
- **Trained model slot**: `models/road-damage.onnx` rakho to YOLOv8 model chalega, warna purana rules engine (fallback). Guide: `docs/MODEL_GUIDE.md`, Colab notebook: `docs/train_road_damage_yolov8.ipynb`
- **Evaluation tool (`evaluate.html`)**: labelled images par Precision / Recall / F1 / speed nikalta hai, paper ke Table I ke liye. Predicted labels JSON bhi deta hai taaki labelling jaldi ho
- History mein har entry par location link, Settings mein GPS aur Detection engine controls

## Research paper ke liye kaise use karein
1. 50-100 road photos jama karo, LabelImg / Roboflow se YOLO txt labels banao.
2. `evaluate.html` kholo, images + txt files ek saath chuno, Run karo.
3. Markdown table copy karke paper ke Table I mein daalo. Phir Colab notebook se model train karke dobara run karo aur dono ka comparison do.


Photo ya live camera se road ke potholes, cracks aur damaged surface detect karta hai aur automatic beep + voice warning deta hai ("Stop! Danger ahead").
Dark navy + turquoise interface, mobile aur desktop dono par chalta hai. Koi server ya internet zaroori nahi.

## Naya update (v4): sahi naam se detection
- **Pothole** -> sirf "Pothole" (paani se bhare gaddhe bhi ab pothole hi bolte hain, crack nahi)
- **Crack** -> sirf "Crack"
- **Koi aur kharabi** -> "Other damage" (warning: "Other type of damage detected")
- **Saaf road** -> "Plain road - keep going" (screen par + voice mein, English)
- **Live monitoring** mein bhi wahi: banner aur voice mein Pothole / Crack / Other damage alag-alag batata hai; live mein damage milte hi beep + voice, road saaf hote hi alarm khud band hoke "Plain road, keep going" bolta hai, aur plain road par har ~10 sec mein yehi dohrata hai
- Lane line / horizon ke kinaaron ko ab crack nahi samajhta

## v5 update
- **Paani ke neeche pothole**: baarish ke paani se bhare gaddhe ab detect hote hain aur "Pothole under water" bolte hain (screen, banner, voice, history chip). Paani ki smooth/reflective surface + kinaare par texture badalne se pehchanta hai
- Live mode: har naye damage par direct beep + voice, type badalne par (crack -> pothole) voice bhi badalti hai

## v6: voice conditions
- Gaddha upar se dikhe (thoda paani bhara ho tab bhi) -> "Potholes are detected"
- Crack -> "Cracks are detected" (live aur photo dono mein)
- Gaddha paani se dhak gaya ho -> "There is a pothole found under the water. Potholes are detected, so there is huge damage. Please stop."

## v7: "under water" sirf tab jab gaddha poora dhak gaya ho
- Normal paani bhare / chamakte puddle -> "Potholes are detected" (under water nahi)
- "Pothole found under the water" sirf bade, gehre (road se kaale) paani ke body par ya jab road ka bada hissa paani mein dooba ho

## v8: jo mila wahi bolta hai
- Awaaz aur screen ka message ab image mein asal mein jo mila uske hisaab se banta hai: sirf crack mila -> "Cracks are detected", sirf gaddha -> "Potholes are detected", dono -> "Potholes and cracks are detected" (live mein bhi)
- "Pothole found under the water" sirf poori tarah paani mein dhake gehre paani par
- Patli line ko pothole nahi samajhta (pothole ke liye mota, thos patch zaroori)

## v9: poora sentence bolta hai
- Alarm ab pehle poori awaaz ("... Danger ahead.") khatam hone deta hai, phir thodi der baad dohrata hai. Pehle agla alarm beech mein hi awaaz kaat deta tha

## Features
1. **Scan Road** - camera se photo lo ya gallery se multiple images chuno
2. **AI Detection** - potholes, cracks aur "Other" (damaged / toota hua surface), confidence aur severity ke saath
3. **Automatic Warning** - damage milte hi beep + voice shuru ho jaati hai aur **baar baar chalti rehti hai jab tak user khud "STOP ALARM" button nahi dabata**. Pothole par "Stop! Danger ahead - pothole", crack par "Caution - crack", other par "Warning - other type of damage". Live mode mein screen par flashing STOP banner. Stop dabane ke baad 10 second tak naya alarm nahi bajta, phir agla damage milne par dobara chalu
4. **Warning Controls** - header ke bell button ya Settings se warnings band/chalu karo
5. **Live Monitoring** - rear camera se continuously road check hoti hai. Alarm tabhi bajta hai jab damage 3 mein se kam se kam 2 frames mein dikhe, isse jhooti alarm kam hoti hain
6. **Separate Results** - har scan ke result alag, purana data naye result mein mix nahi hota
7. **History** - date, time, damage type, confidence
8. **Clear Data** - ek result delete karo ya poori history clear karo
9. **Attractive Interface** - dark navy + turquoise dashboard

## Kaise chalayein

### Computer par
1. Zip extract karo.
2. Folder mein terminal kholo aur chalao: `python -m http.server 8000`
3. Browser mein kholo: http://localhost:8000

(Seedha `index.html` double-click karne se photo scan chalega, lekin Live camera aur "install app" ke liye localhost ya HTTPS chahiye.)

### Phone par (Android)
1. Folder ko **Netlify Drop** (app.netlify.com/drop) ya **GitHub Pages** par upload karo. Dono free hain aur HTTPS dete hain.
2. Phone ke Chrome mein link kholo.
3. Menu (3 dots) -> **Add to Home screen** / **Install app**. Ab ye normal app ki tarah chalega, offline bhi.

## Detection engine kaise kaam karta hai
`detector.js` mein pure JavaScript image analysis hai (koi trained model download nahi hota, isliye offline chalta hai):
- Chhote scale par dark patli lines -> **cracks**
- Bade scale par dark compact patches -> **potholes**
- Road se zyada halke (paani bhare) compact patches jinke aas-paas dark road ho -> **potholes**
- Texture map par jo patch road ke baaki hisse se bahut zyada "khurdura/toota hua" ho -> **Other (damaged surface)**
- Shape (lambai, fill ratio, size) se classify hota hai, phir confidence aur severity nikalti hai
- Har cheez us road ki apni look se compare hoti hai, isliye smooth asphalt, concrete aur khurdari road, sab par adapt hota hai
- Shaam / andhere mein dim frames pehle brighten kiye jaate hain

### Limitations (zaroor padhein)
Ye trained deep-learning model **nahi** hai. Ye brightness/contrast par kaam karta hai, isliye:
- Gehre shadows, tyre marks, oil stains ya patchwork kabhi-kabhi damage jaise lag sakte hain
- Bahut halke cracks ya geele road par miss ho sakte hain
- "Other (damaged surface)" sabse kam bharosemand hai: gaadiyan, ped ya building road ke neeche wale hisse mein aa jayein to galat flag ho sakta hai. Isliye uska confidence hamesha kam rakha hai
- Paani se bhare gaddhe aur "har tarah ki road" ki guarantee heuristic se nahi di ja sakti; uske liye trained model chahiye
- Result sabse achha tab aata hai jab photo saaf aur road ke saamne se li gayi ho

**Accuracy badhane ke liye:** Settings mein *Sensitivity* aur *Minimum confidence* adjust karo.
Aur zyada accuracy chahiye to `detector.js` ko trained model (jaise YOLOv8 road-damage model, TensorFlow.js ya ONNX Runtime Web ke saath) se replace kiya ja sakta hai. `app.js` sirf `RoadDetector.detect(...)` call karta hai, to baaki app wahi rahegi.

## Files
- `geo.js` - GPS helper
- `exif.js` - photo ke andar ki GPS location padhta hai
- `insights.js` - Insights tab, map, export, report
- `report.js` - Report to authority (complaint message, share, WhatsApp, email, PDF)
- `model.js` - optional ONNX model engine
- `evaluate.html`, `evaluate.js` - accuracy evaluation tool
- `docs/`, `models/`, `lib/` - model training guide, model slot, offline runtime slot
- `index.html` - structure
- `style.css` - dark navy / turquoise design
- `app.js` - scan, live, warnings, history, settings
- `detector.js` - damage detection engine
- `manifest.json`, `sw.js`, `icons/` - installable offline app (PWA)
