(function(){
  "use strict";
  if(location.protocol==="file:")return;

  var NUMBER="94761294204";
  var data=null;
  var activeDestination=null;
  var activePlan=null;
  var galleryIndex=0;

  function $(id){return document.getElementById(id)}
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]})}
  function cover(images){return (images||[]).find(function(image){return image.isCover})||(images||[])[0]||null}
  function list(items){return (items||[]).filter(Boolean)}
  function priceText(plan){
    if(plan.startingPrice)return (plan.priceLabel&&plan.priceLabel!=="Contact us"?plan.priceLabel+" ":"From ")+plan.currency+" "+plan.startingPrice;
    return plan.priceLabel||"Contact us";
  }
  function visiblePlans(destination){return (destination.plans||[]).filter(function(plan){return plan.status==="published"}).sort(function(a,b){return Number(a.order||0)-Number(b.order||0)})}
  function publicDestinations(){return (data&&data.destinations||[]).filter(function(destination){return destination.status==="published"}).sort(function(a,b){return Number(a.order||0)-Number(b.order||0)})}

  async function load(){
    try{
      var response=await fetch("/api/public-data",{cache:"no-store"});
      if(!response.ok)throw new Error("No public data");
      data=await response.json();
      if(!publicDestinations().length)return;
      renderCards();
      bindManagedEvents();
      var requested=new URLSearchParams(location.search).get("destination");
      if(requested){
        var destination=publicDestinations().find(function(item){return item.slug===requested||item.id===requested});
        if(destination)window.setTimeout(function(){openDestination(destination.id)},120);
      }
    }catch(err){
      data=null;
    }
  }

  function renderCards(){
    var cards=$("planCards");
    if(!cards)return;
    cards.innerHTML=publicDestinations().map(function(destination){
      var image=cover(destination.gallery);
      var plans=visiblePlans(destination);
      var first=plans[0]||{};
      return '<article class="plan-card" tabindex="0" role="button" data-managed-destination="'+esc(destination.id)+'" aria-label="Open '+esc(destination.name)+' destination">'+
        '<div class="plan-photo">'+
          (image?'<img src="'+esc(image.src)+'" alt="'+esc(image.alt||destination.name)+'" loading="lazy" decoding="async">':'')+
          '<div class="photo-placeholder">Destination photo</div>'+
          '<span class="plan-tag">'+esc(destination.region||"Sri Lanka")+'</span>'+
          '<span class="managed-plan-count">'+plans.length+' plan'+(plans.length===1?"":"s")+'</span>'+
        '</div>'+
        '<div class="plan-body"><h3>'+esc(destination.name)+'</h3><p class="plan-desc">'+esc(destination.shortDescription||destination.fullDescription||"Private Sri Lanka tour destination.")+'</p><div class="plan-meta"><span>'+esc(first.duration||"Custom duration")+'</span><span>'+esc(priceText(first))+'</span><span>'+esc(destination.location&&destination.location.name||"Sri Lanka")+'</span></div></div>'+
      '</article>';
    }).join("");
  }

  function bindManagedEvents(){
    var cards=$("planCards");
    if(!cards||cards.dataset.managedBound)return;
    cards.dataset.managedBound="true";
    cards.addEventListener("click",function(event){
      var card=event.target.closest("[data-managed-destination]");
      if(!card)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openDestination(card.dataset.managedDestination);
    },true);
    cards.addEventListener("keydown",function(event){
      var card=event.target.closest("[data-managed-destination]");
      if(card&&(event.key==="Enter"||event.key===" ")){
        event.preventDefault();
        event.stopImmediatePropagation();
        openDestination(card.dataset.managedDestination);
      }
    },true);
  }

  function destinationById(id){return publicDestinations().find(function(destination){return destination.id===id})}
  function planById(destination,id){return visiblePlans(destination).find(function(plan){return plan.id===id})||visiblePlans(destination)[0]}

  function ensureManagedBlocks(){
    var grid=document.querySelector("#planModal .modal-grid");
    if(!$("managedPlanChooser")){
      var chooser=document.createElement("div");
      chooser.className="detail-box";
      chooser.id="managedPlanChooser";
      chooser.style.gridColumn="1/-1";
      grid.insertBefore(chooser,grid.firstChild);
    }
    if(!$("managedLocationBox")){
      var location=document.createElement("div");
      location.className="managed-location-box";
      location.id="managedLocationBox";
      var booking=grid.querySelector(".booking");
      grid.insertBefore(location,booking);
    }
  }

  function openDestination(destinationId,planId){
    var destination=destinationById(destinationId);
    if(!destination)return;
    var plan=planById(destination,planId);
    if(!plan)return;
    activeDestination=destination;
    activePlan=plan;
    ensureManagedBlocks();
    renderModal();
    var modal=$("planModal");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden","false");
    document.body.style.overflow="hidden";
    var calculate=$("calculateRoute");
    calculate.onclick=function(){calculateRoute(false)};
    var book=$("bookPlan");
    book.onclick=bookPlan;
    window.setTimeout(function(){calculateRoute(true)},120);
  }

  function renderModal(){
    $("modalTitle").textContent=activeDestination.name;
    $("modalDesc").textContent=activeDestination.fullDescription||activeDestination.shortDescription||activePlan.shortDescription||"";
    renderPlanChooser();
    renderManagedGallery();
    renderItinerary();
    renderDetails();
    renderLocation();
    $("pickupLocation").value="";
    $("routeResult").style.display="none";
    $("routeResult").innerHTML="";
    $("mapLink").style.display="none";
  }

  function renderPlanChooser(){
    var plans=visiblePlans(activeDestination);
    var chooser=$("managedPlanChooser");
    chooser.innerHTML='<h3>Available tour plans</h3><p style="color:#555;margin-top:6px">Choose the plan length and style that fits your trip.</p><div class="destination-plan-switcher">'+plans.map(function(plan){
      return '<button type="button" class="'+(plan.id===activePlan.id?"active":"")+'" data-managed-plan="'+esc(plan.id)+'">'+esc(plan.name)+' · '+esc(plan.duration||"Custom")+'</button>';
    }).join("")+'</div>';
    chooser.onclick=function(event){
      var btn=event.target.closest("[data-managed-plan]");
      if(!btn)return;
      activePlan=planById(activeDestination,btn.dataset.managedPlan);
      renderModal();
      window.setTimeout(function(){calculateRoute(true)},120);
    };
  }

  function renderManagedGallery(){
    var gallery=$("modalGallery");
    var photos=(activePlan.gallery&&activePlan.gallery.length?activePlan.gallery:activeDestination.gallery)||[];
    if(!photos.length)photos=[{src:cover(activeDestination.gallery)&&cover(activeDestination.gallery).src||"",alt:activeDestination.name}];
    photos=photos.filter(function(photo){return photo&&photo.src});
    galleryIndex=0;
    gallery.innerHTML=photos.map(function(photo,index){
      return '<div class="gallery-slide '+(index===0?'active':'')+'"><img src="'+esc(photo.src)+'" alt="'+esc(photo.alt||activeDestination.name+" photo "+(index+1))+'" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'grid\';"><div class="gallery-placeholder">Safe Bee Tours photo</div></div>';
    }).join("")+'<div class="gallery-nav"><button type="button" id="galleryPrev" aria-label="Previous photo">&lsaquo;</button><button type="button" id="galleryNext" aria-label="Next photo">&rsaquo;</button></div><div class="gallery-dots">'+photos.map(function(_,index){return '<button type="button" data-slide="'+index+'" class="'+(index===0?'active':'')+'" aria-label="Photo '+(index+1)+'"></button>'}).join("")+'</div>';
    var slides=gallery.querySelectorAll(".gallery-slide"),dots=gallery.querySelectorAll(".gallery-dots button");
    function show(index){
      if(!slides.length)return;
      galleryIndex=(index+slides.length)%slides.length;
      slides.forEach(function(slide,n){slide.classList.toggle("active",n===galleryIndex)});
      dots.forEach(function(dot,n){dot.classList.toggle("active",n===galleryIndex)});
    }
    $("galleryPrev").onclick=function(){show(galleryIndex-1)};
    $("galleryNext").onclick=function(){show(galleryIndex+1)};
    dots.forEach(function(dot){dot.onclick=function(){show(Number(dot.dataset.slide))}});
  }

  function renderItinerary(){
    var days=(activePlan.itineraryDays||[]).sort(function(a,b){return Number(a.order||0)-Number(b.order||0)});
    $("modalItinerary").innerHTML=days.length?days.map(function(day,index){
      var bits=[day.description,list(day.activities).join(", "),list(day.places).length?"Places: "+list(day.places).join(", "):"",day.meals?"Meals: "+day.meals:"",day.accommodation?"Accommodation: "+day.accommodation:"",day.notes].filter(Boolean);
      return '<li><strong>Day '+(index+1)+' - '+esc(day.title||"Itinerary")+'</strong><br>'+esc(bits.join(" | "))+'</li>';
    }).join(""):'<li>Detailed itinerary can be customized with Safe Bee Tours.</li>';
  }

  function section(title,items){
    if(Array.isArray(items)){
      items=list(items);
      if(!items.length)return "";
      return '<div class="managed-detail-section"><h4>'+esc(title)+'</h4><ul>'+items.map(function(item){return '<li>'+esc(item)+'</li>'}).join("")+'</ul></div>';
    }
    if(!items)return "";
    return '<div class="managed-detail-section"><h4>'+esc(title)+'</h4><p>'+esc(items)+'</p></div>';
  }

  function renderDetails(){
    var details=$("modalDetails");
    details.innerHTML=
      '<div class="managed-detail-section"><h4>Plan summary</h4><p><strong>'+esc(activePlan.duration||"Custom duration")+'</strong> <span class="price-pill">'+esc(priceText(activePlan))+'</span></p><p style="margin-top:8px">'+esc(activePlan.shortDescription||"Private tour plan customized around your dates and pace.")+'</p></div>'+
      section("Highlights",activePlan.highlights)+
      section("What's included",activePlan.included)+
      section("What's not included",activePlan.excluded)+
      section("Important information",activePlan.importantInfo)+
      section("Things to bring",activePlan.thingsToBring)+
      section("Pickup information",activePlan.pickupInfo)+
      section("Accommodation details",activePlan.accommodationDetails)+
      section("Transportation details",activePlan.transportationDetails)+
      section("Terms / conditions",activePlan.terms);
  }

  function mapSrc(){
    var location=activeDestination.location||{};
    if(location.googleMapsEmbedUrl)return location.googleMapsEmbedUrl;
    if(location.latitude!==""&&location.longitude!=="")return "https://www.google.com/maps?q="+encodeURIComponent(location.latitude+","+location.longitude)+"&output=embed";
    if(location.address)return "https://www.google.com/maps?q="+encodeURIComponent(location.address)+"&output=embed";
    return "";
  }

  function renderLocation(){
    var location=activeDestination.location||{};
    var src=mapSrc();
    $("managedLocationBox").innerHTML='<h3>Destination location</h3><div class="managed-location-grid"><div><p>'+esc(location.name||activeDestination.name)+'</p><p style="color:#555;margin-top:7px">'+esc(location.address||"Sri Lanka")+'</p>'+(location.googleMapsUrl?'<a class="map-link" href="'+esc(location.googleMapsUrl)+'" target="_blank" rel="noopener">Open destination in Google Maps</a>':'')+'</div><div class="managed-map">'+(src?'<iframe src="'+esc(src)+'" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>':'<div class="managed-map-empty">Map preview will appear after the destination location is added.</div>')+'</div></div>';
  }

  function escRoute(value){return String(value||"").trim()}
  async function geocode(q){
    var r=await fetch("https://photon.komoot.io/api/?q="+encodeURIComponent(q)+"&limit=1");
    if(!r.ok)throw new Error("Location service unavailable");
    var j=await r.json();
    if(!j.features||!j.features.length)throw new Error("Location not found");
    return j.features[0].geometry.coordinates;
  }
  async function routeFor(origin){
    var stops=list(activePlan.routeStops);
    if(!stops.length&&activeDestination.location&&activeDestination.location.name)stops=[activeDestination.location.name+", Sri Lanka"];
    var points=[await geocode(origin)];
    for(var i=0;i<stops.length;i++)points.push(await geocode(stops[i]));
    points.push(points[0]);
    var coords=points.map(function(point){return point[0]+","+point[1]}).join(";");
    var r=await fetch("https://router.project-osrm.org/route/v1/driving/"+coords+"?overview=false&steps=false");
    if(!r.ok)throw new Error("Route service unavailable");
    var j=await r.json();
    if(j.code!=="Ok"||!j.routes||!j.routes[0])throw new Error("Could not calculate this route");
    return {km:j.routes[0].distance/1000,minutes:j.routes[0].duration/60,stops:stops};
  }
  async function calculateRoute(){
    var input=$("pickupLocation"),res=$("routeResult"),map=$("mapLink"),origin=escRoute(input.value)||"Bandaranaike International Airport, Katunayake, Sri Lanka";
    var btn=$("calculateRoute");
    btn.disabled=true;
    btn.textContent="Calculating...";
    res.style.display="block";
    res.innerHTML="Calculating the route preview...";
    try{
      var route=await routeFor(origin),hours=Math.floor(route.minutes/60),mins=Math.round(route.minutes%60),time=(hours?hours+" hr ":"")+mins+" min";
      res.innerHTML='<strong>Approx. round-trip distance: '+route.km.toFixed(0)+' km</strong><small>Approx. driving time: '+time+' · Start: '+esc(origin)+' · Route: '+route.stops.map(esc).join(' -> ')+' · Return to '+esc(origin)+'</small>';
      var wp=[origin].concat(route.stops).concat([origin]);
      map.href="https://www.google.com/maps/dir/"+wp.map(encodeURIComponent).join("/");
      map.style.display="inline-block";
    }catch(err){
      res.innerHTML='<strong>Route preview is unavailable right now.</strong><small>You can still view the plan and send a booking request. The final route can be confirmed with Safe Bee Tours.</small>';
      map.style.display="none";
    }
    btn.disabled=false;
    btn.textContent="Update route";
  }

  function bookPlan(){
    var name=$("bookName").value.trim(),phone=$("bookPhone").value.trim(),date=$("bookDate").value,people=$("bookPeople").value,notes=$("bookNotes").value.trim(),pickup=$("pickupLocation").value.trim();
    if(!name||!phone||!date){
      alert("Please enter your name, phone number and preferred date.");
      return;
    }
    var stops=list(activePlan.routeStops);
    var lines=["*New tour booking request - Safe Bee Tours*","","Destination: "+activeDestination.name,"Plan: "+activePlan.name,"Duration: "+(activePlan.duration||"Custom"),"Price: "+priceText(activePlan),"Customer: "+name,"Phone: "+phone,"Preferred date: "+date,"Travellers: "+people,"Pickup location: "+(pickup||"Bandaranaike International Airport, Katunayake, Sri Lanka (default)"),stops.length?"Route: pickup -> "+stops.join(" -> ")+" -> pickup":null,notes?"Special requests: "+notes:null,"","Customer understands the itinerary can be customized by discussion.","Please confirm availability, final route, timing and price."].filter(Boolean);
    window.open("https://wa.me/"+NUMBER+"?text="+encodeURIComponent(lines.join("\n")),"_blank");
  }

  load();
})();
