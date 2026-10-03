(function(){
  "use strict";

  var API_ENABLED=location.protocol!=="file:";
  var STORAGE_KEY="safeBeeDestinationData";
  var state={version:1,updatedAt:null,destinations:[]};
  var draft=null;
  var activeTab="basic";
  var openPlanId=null;
  var dirty=false;
  var dragInfo=null;

  function $(id){return document.getElementById(id)}
  function esc(value){return String(value==null?"":value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]})}
  function uid(prefix){return prefix+"-"+Date.now()+"-"+Math.random().toString(16).slice(2,8)}
  function clone(value){return JSON.parse(JSON.stringify(value))}
  function now(){return new Date().toISOString()}
  function slugify(value){return String(value||"destination").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"destination"}
  function parseLines(value){return String(value||"").split(/\r?\n|,/).map(function(item){return item.trim()}).filter(Boolean)}
  function lines(value){return (value||[]).join("\n")}
  function formatDate(value){if(!value)return "Not saved yet";try{return new Intl.DateTimeFormat("en",{day:"numeric",month:"short",year:"numeric"}).format(new Date(value))}catch(err){return value}}
  function cover(images){return (images||[]).find(function(image){return image.isCover})||(images||[])[0]||null}
  function toast(message,kind){
    var el=$("toast");
    if(!el)return;
    el.textContent=message;
    el.style.borderColor=kind==="error"?"#f0c8c3":"#bee4cd";
    el.style.background=kind==="error"?"#fff0ee":"#effaf3";
    el.style.color=kind==="error"?"#b42318":"#176c3a";
    el.classList.add("show");
    window.clearTimeout(toast.timer);
    toast.timer=window.setTimeout(function(){el.classList.remove("show")},3000);
  }
  function openModal(el){el.classList.add("open");el.setAttribute("aria-hidden","false");document.body.classList.add("modal-open")}
  function closeModal(el){el.classList.remove("open");el.setAttribute("aria-hidden","true");if(!document.querySelector(".modal.open"))document.body.classList.remove("modal-open")}
  function showError(message){
    var box=$("destinationError");
    if(!box){toast(message,"error");return}
    box.textContent=message;
    box.classList.add("show");
  }
  function clearError(){var box=$("destinationError");if(box){box.classList.remove("show");box.textContent=""}}

  function confirmAction(title,text,buttonText){
    return new Promise(function(resolve){
      var modal=$("confirmModal"),titleEl=$("confirmTitle"),textEl=$("confirmText"),cancel=$("cancelConfirm"),action=$("confirmAction");
      titleEl.textContent=title;
      textEl.textContent=text;
      action.textContent=buttonText||"Confirm";
      openModal(modal);
      function cleanup(result){
        cancel.removeEventListener("click",onCancel);
        action.removeEventListener("click",onAction);
        action.textContent="Confirm";
        resolve(result);
      }
      function onCancel(){cleanup(false)}
      function onAction(){cleanup(true)}
      cancel.addEventListener("click",onCancel,{once:true});
      action.addEventListener("click",onAction,{once:true});
    });
  }

  async function api(path,options){
    var response=await fetch(path,Object.assign({headers:{"Content-Type":"application/json"}},options||{}));
    var payload=null;
    try{payload=await response.json()}catch(err){}
    if(!response.ok)throw new Error(payload&&payload.error||"Request failed");
    return payload;
  }

  async function verifySession(){
    if(!API_ENABLED)return true;
    try{
      await api("/api/admin/session");
      return true;
    }catch(err){
      sessionStorage.removeItem("safeBeeAdminAuthenticated");
      location.replace("/admin/login/");
      return false;
    }
  }

  async function loadData(){
    $("destinationSkeleton").style.display="grid";
    $("destinationCards").innerHTML="";
    try{
      if(API_ENABLED){
        state=await api("/api/admin/data");
      }else{
        state=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")||{version:1,updatedAt:null,destinations:[]};
      }
    }catch(err){
      state=JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")||{version:1,updatedAt:null,destinations:[]};
      toast("Unable to load server data. Run node server.js for full publishing.", "error");
    }
    $("destinationSkeleton").style.display="none";
    renderDestinations();
    renderPlansIndex();
  }

  async function saveState(){
    if(API_ENABLED){
      state=await api("/api/admin/data",{method:"PUT",body:JSON.stringify(state)});
    }else{
      state.updatedAt=now();
      localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    }
    renderDestinations();
    renderPlansIndex();
  }

  function visibleDestinations(){
    var query=($("destinationSearch").value||"").trim().toLowerCase();
    var status=$("destinationStatusFilter").value;
    var sort=$("destinationSort").value;
    var items=(state.destinations||[]).filter(function(destination){
      if(destination.archivedAt)return false;
      var hay=[destination.name,destination.region,destination.shortDescription,destination.fullDescription].join(" ").toLowerCase();
      return (!query||hay.indexOf(query)>-1)&&(status==="all"||destination.status===status);
    });
    items.sort(function(a,b){
      if(sort==="newest")return new Date(b.createdAt||b.updatedAt||0)-new Date(a.createdAt||a.updatedAt||0);
      if(sort==="oldest")return new Date(a.createdAt||a.updatedAt||0)-new Date(b.createdAt||b.updatedAt||0);
      if(sort==="az")return String(a.name||"").localeCompare(String(b.name||""));
      if(sort==="za")return String(b.name||"").localeCompare(String(a.name||""));
      return Number(a.order||0)-Number(b.order||0);
    });
    return items;
  }

  function canDragDestinations(){
    return $("destinationSort").value==="custom"&&$("destinationStatusFilter").value==="all"&&!$("destinationSearch").value.trim();
  }

  function renderDestinations(){
    var items=visibleDestinations();
    var grid=$("destinationCards");
    if(!items.length){
      grid.innerHTML='<div class="empty" style="grid-column:1/-1"><div><strong>No destinations found.</strong><span>Create a destination or adjust your search filters.</span></div></div>';
      return;
    }
    grid.innerHTML=items.map(function(destination){
      var image=cover(destination.gallery);
      var plans=(destination.plans||[]).filter(function(plan){return plan.status!=="archived"});
      return '<article class="destination-card" draggable="'+(canDragDestinations()?"true":"false")+'" data-destination-id="'+esc(destination.id)+'">'+
        '<div class="destination-cover">'+
          (image?'<img src="'+esc(image.src)+'" alt="'+esc(image.alt||destination.name)+'">':'')+
          '<button class="drag-handle" type="button" aria-label="Drag destination" title="Drag to reorder">::</button>'+
        '</div>'+
        '<div class="destination-body">'+
          '<div class="destination-title-row"><div><h3>'+esc(destination.name)+'</h3><span class="status-badge status-'+esc(destination.status||"draft")+'">'+esc(destination.status||"draft")+'</span></div><div class="more-wrap"><button class="icon-btn" type="button" data-action="menu" aria-label="More actions">...</button><div class="more-menu">'+
          '<button type="button" data-action="view">View</button>'+
          '<button type="button" data-action="edit">Edit</button>'+
          '<button type="button" data-action="duplicate">Duplicate</button>'+
          '<button type="button" data-action="toggle-publish">'+(destination.status==="published"?"Unpublish":"Publish")+'</button>'+
          '<button class="danger" type="button" data-action="delete">Delete</button>'+
          '</div></div></div>'+
          '<p class="destination-desc">'+esc(destination.shortDescription||destination.fullDescription||"No description yet.")+'</p>'+
          '<div class="destination-meta"><span class="meta-chip">'+esc(destination.region||"Region not set")+'</span><span class="meta-chip">'+plans.length+' plan'+(plans.length===1?"":"s")+'</span><span class="meta-chip">Updated '+esc(formatDate(destination.updatedAt))+'</span></div>'+
          '<div class="destination-card-foot"><button class="btn secondary" type="button" data-action="edit">Edit</button><div class="destination-card-actions"><button class="mini-btn" type="button" data-action="toggle-publish">'+(destination.status==="published"?"Unpublish":"Publish")+'</button></div></div>'+
        '</div>'+
      '</article>';
    }).join("");
  }

  function allPlans(){
    var plans=[];
    (state.destinations||[]).filter(function(destination){return !destination.archivedAt}).sort(function(a,b){return Number(a.order||0)-Number(b.order||0)}).forEach(function(destination){
      (destination.plans||[]).forEach(function(plan){
        plans.push({destination:destination,plan:plan});
      });
    });
    return plans;
  }

  function renderPlansIndex(){
    var grid=$("tourCards");
    if(!grid)return;
    var query=($("planSearch").value||"").trim().toLowerCase();
    var status=$("planStatusFilter").value;
    var sort=$("planSort").value;
    var plans=allPlans().filter(function(item){
      var hay=[item.plan.name,item.destination.name,item.plan.duration,item.plan.shortDescription].join(" ").toLowerCase();
      return (!query||hay.indexOf(query)>-1)&&(status==="all"||item.plan.status===status);
    });
    plans.sort(function(a,b){
      if(sort==="az")return String(a.plan.name||"").localeCompare(String(b.plan.name||""));
      if(sort==="za")return String(b.plan.name||"").localeCompare(String(a.plan.name||""));
      return Number(a.destination.order||0)-Number(b.destination.order||0)||Number(a.plan.order||0)-Number(b.plan.order||0);
    });
    grid.innerHTML=plans.length?plans.map(function(item){
      var destination=item.destination,plan=item.plan,image=cover(plan.gallery)||cover(destination.gallery);
      return '<article class="readonly-card" data-plan-index-id="'+esc(plan.id)+'" data-destination-id="'+esc(destination.id)+'">'+
        (image?'<img src="'+esc(image.src)+'" alt="'+esc(image.alt||plan.name)+'">':'')+
        '<div><strong>'+esc(plan.name)+'</strong><span>'+esc(destination.name)+' · '+esc(plan.duration||"Duration not set")+' · '+esc(plan.status||"draft")+'</span><p style="margin-top:8px;color:var(--soft);font-size:14px">'+esc(plan.shortDescription||"No short description yet.")+'</p><button class="link-btn" type="button" data-edit-plan="'+esc(plan.id)+'" data-destination-id="'+esc(destination.id)+'">Edit in destination</button></div>'+
      '</article>';
    }).join(""):'<div class="empty" style="grid-column:1/-1"><div><strong>No tour plans match.</strong><span>Try a different search or status filter.</span></div></div>';
  }

  function createDestination(){
    var id=uid("destination");
    var order=(state.destinations||[]).filter(function(item){return !item.archivedAt}).length+1;
    return {
      id:id,
      name:"New Destination",
      shortTitle:"",
      slug:"new-destination-"+id.slice(-6),
      shortDescription:"",
      fullDescription:"",
      region:"",
      featured:false,
      status:"draft",
      order:order,
      createdAt:now(),
      updatedAt:now(),
      location:{name:"",address:"",latitude:"",longitude:"",googleMapsUrl:"",googleMapsEmbedUrl:""},
      seo:{title:"",description:""},
      gallery:[],
      plans:[]
    };
  }

  function createPlan(){
    return {
      id:uid("plan"),
      name:"New Tour Plan",
      shortDescription:"",
      duration:"",
      days:1,
      nights:0,
      startingPrice:"",
      currency:"USD",
      priceLabel:"Contact us",
      status:"draft",
      order:(draft.plans||[]).length+1,
      createdAt:now(),
      updatedAt:now(),
      routeStops:[],
      gallery:[],
      itineraryDays:[createDay(1)],
      highlights:[],
      included:[],
      excluded:[],
      importantInfo:[],
      thingsToBring:[],
      terms:[],
      pickupInfo:"",
      accommodationDetails:"",
      transportationDetails:""
    };
  }

  function createDay(index){
    return {id:uid("day"),dayNumber:index,title:"Day "+index,description:"",activities:[],places:[],meals:"",accommodation:"",notes:"",order:index};
  }

  function setDirty(value){
    dirty=!!value;
    var body=$("destinationEditorBody");
    if(body)body.classList.toggle("unsaved",dirty);
  }

  function findDestination(id){
    return (state.destinations||[]).find(function(destination){return destination.id===id});
  }

  function findPlan(id){
    return (draft.plans||[]).find(function(plan){return plan.id===id});
  }

  function openEditor(id,planId){
    var existing=id?findDestination(id):null;
    draft=existing?clone(existing):createDestination();
    activeTab=planId?"plans":"basic";
    openPlanId=planId||null;
    setDirty(false);
    $("destinationEditorTitle").textContent=existing?"Edit "+draft.name:"Add Destination";
    $("destinationEditorSubtitle").textContent="Manage destination content, tour plans, gallery, location and publishing.";
    renderEditor();
    openModal($("destinationEditorModal"));
  }

  function closeEditor(){
    if(dirty){
      confirmAction("Discard unsaved changes?","You have unsaved destination changes. Closing now will discard them.","Discard changes").then(function(ok){
        if(ok){draft=null;closeModal($("destinationEditorModal"))}
      });
    }else{
      draft=null;
      closeModal($("destinationEditorModal"));
    }
  }

  function renderEditor(){
    if(!draft)return;
    $("destinationEditorBody").innerHTML=
      '<div class="editor-shell">'+
        '<div class="editor-main">'+
          '<div class="editor-tabs">'+["basic","description","location","gallery","plans","seo","publishing"].map(function(tab){
            var label={basic:"Basic Information",description:"Description",location:"Location",gallery:"Gallery",plans:"Tour Plans",seo:"SEO",publishing:"Publishing"}[tab];
            return '<button type="button" data-editor-tab="'+tab+'" class="'+(activeTab===tab?"active":"")+'">'+label+'</button>';
          }).join("")+'</div>'+
          '<div class="inline-error" id="destinationError"></div>'+
          renderBasicTab()+renderDescriptionTab()+renderLocationTab()+renderGalleryTab()+renderPlansTab()+renderSeoTab()+renderPublishingTab()+
        '</div>'+
        '<aside class="editor-sidebar" id="destinationSidebar">'+renderSidebar()+'</aside>'+
      '</div>';
    bindDropZones();
  }

  function field(id,label,value,attrs){
    attrs=attrs||"";
    return '<div class="field"><label for="'+id+'">'+label+'</label><input id="'+id+'" value="'+esc(value||"")+'" '+attrs+'></div>';
  }
  function textarea(id,label,value,attrs){
    attrs=attrs||"";
    return '<div class="field full"><label for="'+id+'">'+label+'</label><textarea id="'+id+'" '+attrs+'>'+esc(value||"")+'</textarea></div>';
  }
  function select(id,label,value,options,attrs){
    attrs=attrs||"";
    return '<div class="field"><label for="'+id+'">'+label+'</label><select id="'+id+'" '+attrs+'>'+options.map(function(option){return '<option value="'+esc(option.value)+'" '+(option.value===value?"selected":"")+'>'+esc(option.label)+'</option>'}).join("")+'</select></div>';
  }

  function renderBasicTab(){
    return '<section class="tab-pane '+(activeTab==="basic"?"active":"")+'" data-tab-pane="basic">'+
      '<div class="editor-section"><h3>Basic Information</h3><div class="form-grid">'+
      field("destName","Destination name",draft.name,'data-dest-field="name" required')+
      field("destShortTitle","Short title",draft.shortTitle,'data-dest-field="shortTitle"')+
      field("destSlug","Slug",draft.slug,'data-dest-field="slug"')+
      field("destRegion","Region / category",draft.region,'data-dest-field="region"')+
      textarea("destShortDescription","Short description",draft.shortDescription,'data-dest-field="shortDescription"')+
      '</div></div>'+
      '<div class="editor-section"><h3>Flags</h3><div class="form-grid">'+
      select("destStatus","Destination status",draft.status,[{value:"draft",label:"Draft"},{value:"published",label:"Published"},{value:"unpublished",label:"Unpublished"}],'data-dest-field="status"')+
      '<div class="toggle-row"><div><strong>Featured destination</strong><p style="color:var(--muted);font-size:13px">Highlight this destination publicly where featured content is used.</p></div><label class="switch"><input type="checkbox" '+(draft.featured?"checked":"")+' data-dest-field="featured"><span></span></label></div>'+
      '</div></div>'+
    '</section>';
  }

  function renderDescriptionTab(){
    return '<section class="tab-pane '+(activeTab==="description"?"active":"")+'" data-tab-pane="description">'+
      '<div class="editor-section"><h3>Full Description</h3><p class="help">Use short paragraphs. The public website hides this section if it is empty.</p>'+
      '<textarea style="min-height:260px" data-dest-field="fullDescription">'+esc(draft.fullDescription||"")+'</textarea></div>'+
    '</section>';
  }

  function mapSrc(){
    if(draft.location&&draft.location.googleMapsEmbedUrl)return draft.location.googleMapsEmbedUrl;
    if(draft.location&&draft.location.latitude!==""&&draft.location.longitude!=="")return "https://www.google.com/maps?q="+encodeURIComponent(draft.location.latitude+","+draft.location.longitude)+"&output=embed";
    if(draft.location&&draft.location.address)return "https://www.google.com/maps?q="+encodeURIComponent(draft.location.address)+"&output=embed";
    return "";
  }

  function renderLocationTab(){
    var src=mapSrc();
    return '<section class="tab-pane '+(activeTab==="location"?"active":"")+'" data-tab-pane="location">'+
      '<div class="editor-section"><h3>Location / Google Map</h3><p class="help">Add coordinates or a Google Maps embed URL to preview the exact public map.</p>'+
      '<div class="form-grid">'+
      field("locationSearch","Search location","",'placeholder="Search Sri Lanka locations" data-location-search-input')+
      '<div class="field"><label>&nbsp;</label><button class="btn secondary" type="button" data-action="search-location">Search location</button></div>'+
      field("locName","Location name",draft.location&&draft.location.name,'data-location-field="name"')+
      field("locAddress","Address",draft.location&&draft.location.address,'data-location-field="address"')+
      field("locLat","Latitude",draft.location&&draft.location.latitude,'data-location-field="latitude" inputmode="decimal"')+
      field("locLng","Longitude",draft.location&&draft.location.longitude,'data-location-field="longitude" inputmode="decimal"')+
      textarea("locMapsUrl","Google Maps URL",draft.location&&draft.location.googleMapsUrl,'data-location-field="googleMapsUrl"')+
      textarea("locEmbedUrl","Google Maps Embed URL",draft.location&&draft.location.googleMapsEmbedUrl,'data-location-field="googleMapsEmbedUrl"')+
      '</div></div>'+
      '<div class="map-preview" id="mapPreview">'+(src?'<iframe src="'+esc(src)+'" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>':'<div class="map-fallback"><div><strong>No map preview yet.</strong><span>Enter coordinates, an address or an embed URL.</span></div></div>')+'</div>'+
    '</section>';
  }

  function renderGalleryTab(){
    return '<section class="tab-pane '+(activeTab==="gallery"?"active":"")+'" data-tab-pane="gallery">'+
      '<div class="editor-section"><h3>Destination Gallery</h3><p class="help">Upload, reorder, caption and choose a cover image for this destination.</p>'+renderMediaManager("destination",null,draft.gallery||[])+'</div>'+
    '</section>';
  }

  function renderMediaManager(scope,planId,images){
    var suffix=scope+(planId?("-"+planId):"");
    return '<div class="media-manager" data-media-scope="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'>'+
      '<div class="media-drop" tabindex="0" data-upload-drop="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'><div><strong>Drag & drop images here</strong><span>JPG, JPEG, PNG or WebP. Images are validated before saving.</span><button class="btn secondary" type="button" data-action="browse-media" data-scope="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+' style="margin-top:12px">Browse images</button></div></div>'+
      '<input id="mediaInput-'+esc(suffix)+'" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden data-media-input="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'>'+
      '<div class="status-line" data-upload-status="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'></div>'+
      '<div class="media-grid-editor">'+(images||[]).sort(function(a,b){return Number(a.order||0)-Number(b.order||0)}).map(function(image){
        return '<article class="media-tile" draggable="true" data-image-id="'+esc(image.id)+'" data-media-scope="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'>'+
          '<figure><img src="'+esc(image.src)+'" alt="'+esc(image.alt||"Destination image")+'">'+(image.isCover?'<span class="cover-flag">Cover</span>':'')+'</figure>'+
          '<div class="media-tile-body">'+
            '<input placeholder="Alt text" value="'+esc(image.alt||"")+'" data-image-field="alt" data-image-id="'+esc(image.id)+'" data-media-scope="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'>'+
            '<input placeholder="Caption" value="'+esc(image.caption||"")+'" data-image-field="caption" data-image-id="'+esc(image.id)+'" data-media-scope="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'>'+
            '<div class="media-tile-actions"><button class="mini-btn" type="button" data-action="set-cover" data-image-id="'+esc(image.id)+'" data-scope="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'>Cover</button><button class="mini-btn" type="button" data-action="replace-image" data-image-id="'+esc(image.id)+'" data-scope="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'>Replace</button><button class="mini-btn danger full" type="button" data-action="delete-image" data-image-id="'+esc(image.id)+'" data-scope="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'>Delete</button></div>'+
            '<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-replace-input="'+esc(image.id)+'" data-media-scope="'+esc(scope)+'" '+(planId?'data-plan-id="'+esc(planId)+'"':"")+'>'+
          '</div>'+
        '</article>';
      }).join("")+'</div>'+
    '</div>';
  }

  function renderPlansTab(){
    return '<section class="tab-pane '+(activeTab==="plans"?"active":"")+'" data-tab-pane="plans">'+
      '<div class="editor-section">'+
        '<div class="plan-toolbar"><div><h3>Tour Plans / Itineraries</h3><p class="help">Each destination can have multiple independent published or draft plans.</p></div><button class="btn" type="button" data-action="add-plan">+ Add plan</button></div>'+
        '<div class="plan-list-editor">'+((draft.plans||[]).length?draft.plans.sort(function(a,b){return Number(a.order||0)-Number(b.order||0)}).map(renderPlanCard).join(""):'<div class="empty"><div><strong>No tour plans yet.</strong><span>Add a plan to build pricing, itinerary and optional detail sections.</span></div></div>')+'</div>'+
      '</div>'+
    '</section>';
  }

  function renderPlanCard(plan){
    var open=openPlanId===plan.id;
    return '<article class="plan-manage-card '+(open?"open":"")+'" draggable="true" data-plan-card="'+esc(plan.id)+'">'+
      '<div class="plan-manage-head">'+
        '<button class="drag-handle" type="button" title="Drag to reorder">::</button>'+
        '<div><strong>'+esc(plan.name||"Untitled plan")+'</strong><span>'+esc(plan.duration||"Duration not set")+' · '+esc(plan.status||"draft")+' · '+(plan.itineraryDays||[]).length+' day item'+((plan.itineraryDays||[]).length===1?"":"s")+'</span></div>'+
        '<div class="plan-actions"><button class="mini-btn" type="button" data-action="toggle-plan" data-plan-id="'+esc(plan.id)+'">'+(open?"Close":"Edit")+'</button><button class="mini-btn" type="button" data-action="duplicate-plan" data-plan-id="'+esc(plan.id)+'">Duplicate</button><button class="mini-btn" type="button" data-action="toggle-plan-publish" data-plan-id="'+esc(plan.id)+'">'+(plan.status==="published"?"Unpublish":"Publish")+'</button><button class="mini-btn danger" type="button" data-action="delete-plan" data-plan-id="'+esc(plan.id)+'">Delete</button></div>'+
      '</div>'+
      '<div class="plan-editor-body">'+renderPlanEditor(plan)+'</div>'+
    '</article>';
  }

  function renderPlanEditor(plan){
    return '<div class="editor-section"><h3>Basic Details</h3><div class="form-grid">'+
      field("planName-"+plan.id,"Plan name",plan.name,'data-plan-field="name" data-plan-id="'+esc(plan.id)+'"')+
      field("planDuration-"+plan.id,"Duration",plan.duration,'data-plan-field="duration" data-plan-id="'+esc(plan.id)+'" placeholder="2 Days / 1 Night"')+
      field("planDays-"+plan.id,"Number of days",plan.days,'type="number" min="0" data-plan-field="days" data-plan-id="'+esc(plan.id)+'"')+
      field("planNights-"+plan.id,"Number of nights",plan.nights,'type="number" min="0" data-plan-field="nights" data-plan-id="'+esc(plan.id)+'"')+
      field("planPrice-"+plan.id,"Starting price (optional)",plan.startingPrice,'data-plan-field="startingPrice" data-plan-id="'+esc(plan.id)+'"')+
      field("planCurrency-"+plan.id,"Currency",plan.currency,'data-plan-field="currency" data-plan-id="'+esc(plan.id)+'"')+
      select("planPriceLabel-"+plan.id,"Price label",plan.priceLabel,[{value:"From",label:"From"},{value:"Per person",label:"Per person"},{value:"Per couple",label:"Per couple"},{value:"Contact us",label:"Contact us"}],'data-plan-field="priceLabel" data-plan-id="'+esc(plan.id)+'"')+
      select("planStatus-"+plan.id,"Plan status",plan.status,[{value:"draft",label:"Draft"},{value:"published",label:"Published"},{value:"unpublished",label:"Unpublished"}],'data-plan-field="status" data-plan-id="'+esc(plan.id)+'"')+
      textarea("planShort-"+plan.id,"Short description",plan.shortDescription,'data-plan-field="shortDescription" data-plan-id="'+esc(plan.id)+'"')+
      textarea("planStops-"+plan.id,"Route stops (one per line)",lines(plan.routeStops),'data-plan-list-field="routeStops" data-plan-id="'+esc(plan.id)+'"')+
      '</div></div>'+
      '<div class="editor-section"><h3>Plan Images</h3>'+renderMediaManager("plan",plan.id,plan.gallery||[])+'</div>'+
      '<div class="editor-section"><div class="plan-toolbar"><div><h3>Itinerary Builder</h3><p class="help">Create timeline days, activities, places, meals and notes.</p></div><button class="btn secondary" type="button" data-action="add-day" data-plan-id="'+esc(plan.id)+'">+ Add day</button></div><div class="day-list">'+((plan.itineraryDays||[]).length?plan.itineraryDays.sort(function(a,b){return Number(a.order||0)-Number(b.order||0)}).map(function(day,index){return renderDay(plan.id,day,index)}).join(""):'<div class="empty"><div><strong>No days yet.</strong><span>Add a day to start building the itinerary.</span></div></div>')+'</div></div>'+
      '<div class="editor-section"><h3>Optional Plan Details</h3><p class="help">Empty sections are hidden automatically on the public website.</p><div class="form-grid">'+
      textarea("planHighlights-"+plan.id,"Highlights",lines(plan.highlights),'data-plan-list-field="highlights" data-plan-id="'+esc(plan.id)+'"')+
      textarea("planIncluded-"+plan.id,"What is included",lines(plan.included),'data-plan-list-field="included" data-plan-id="'+esc(plan.id)+'"')+
      textarea("planExcluded-"+plan.id,"What is not included",lines(plan.excluded),'data-plan-list-field="excluded" data-plan-id="'+esc(plan.id)+'"')+
      textarea("planImportant-"+plan.id,"Important information",lines(plan.importantInfo),'data-plan-list-field="importantInfo" data-plan-id="'+esc(plan.id)+'"')+
      textarea("planBring-"+plan.id,"Things to bring",lines(plan.thingsToBring),'data-plan-list-field="thingsToBring" data-plan-id="'+esc(plan.id)+'"')+
      textarea("planTerms-"+plan.id,"Terms / conditions",lines(plan.terms),'data-plan-list-field="terms" data-plan-id="'+esc(plan.id)+'"')+
      textarea("planPickup-"+plan.id,"Pickup information",plan.pickupInfo,'data-plan-field="pickupInfo" data-plan-id="'+esc(plan.id)+'"')+
      textarea("planAccommodation-"+plan.id,"Accommodation details",plan.accommodationDetails,'data-plan-field="accommodationDetails" data-plan-id="'+esc(plan.id)+'"')+
      textarea("planTransport-"+plan.id,"Transportation details",plan.transportationDetails,'data-plan-field="transportationDetails" data-plan-id="'+esc(plan.id)+'"')+
      '</div></div>';
  }

  function renderDay(planId,day,index){
    return '<article class="day-card" draggable="true" data-day-id="'+esc(day.id)+'" data-plan-id="'+esc(planId)+'">'+
      '<div class="day-card-head"><strong>Day '+(index+1)+'</strong><div class="day-card-actions"><button class="mini-btn" type="button" data-action="duplicate-day" data-plan-id="'+esc(planId)+'" data-day-id="'+esc(day.id)+'">Duplicate</button><button class="mini-btn danger" type="button" data-action="delete-day" data-plan-id="'+esc(planId)+'" data-day-id="'+esc(day.id)+'">Delete</button></div></div>'+
      '<div class="form-grid">'+
      field("dayTitle-"+day.id,"Title",day.title,'data-day-field="title" data-plan-id="'+esc(planId)+'" data-day-id="'+esc(day.id)+'"')+
      field("dayMeals-"+day.id,"Meals",day.meals,'data-day-field="meals" data-plan-id="'+esc(planId)+'" data-day-id="'+esc(day.id)+'"')+
      textarea("dayDescription-"+day.id,"Description",day.description,'data-day-field="description" data-plan-id="'+esc(planId)+'" data-day-id="'+esc(day.id)+'"')+
      textarea("dayActivities-"+day.id,"Activities",lines(day.activities),'data-day-list-field="activities" data-plan-id="'+esc(planId)+'" data-day-id="'+esc(day.id)+'"')+
      textarea("dayPlaces-"+day.id,"Places visited",lines(day.places),'data-day-list-field="places" data-plan-id="'+esc(planId)+'" data-day-id="'+esc(day.id)+'"')+
      textarea("dayAccommodation-"+day.id,"Accommodation",day.accommodation,'data-day-field="accommodation" data-plan-id="'+esc(planId)+'" data-day-id="'+esc(day.id)+'"')+
      textarea("dayNotes-"+day.id,"Optional notes",day.notes,'data-day-field="notes" data-plan-id="'+esc(planId)+'" data-day-id="'+esc(day.id)+'"')+
      '</div>'+
    '</article>';
  }

  function renderSeoTab(){
    return '<section class="tab-pane '+(activeTab==="seo"?"active":"")+'" data-tab-pane="seo">'+
      '<div class="editor-section"><h3>SEO</h3><div class="form-grid">'+
      field("seoTitle","SEO title",draft.seo&&draft.seo.title,'data-seo-field="title"')+
      textarea("seoDescription","SEO description",draft.seo&&draft.seo.description,'data-seo-field="description"')+
      '</div></div>'+
    '</section>';
  }

  function renderPublishingTab(){
    return '<section class="tab-pane '+(activeTab==="publishing"?"active":"")+'" data-tab-pane="publishing">'+
      '<div class="editor-section"><h3>Publishing</h3><p class="help">Draft destinations and draft plans remain visible only inside the admin workspace.</p><div class="detail-grid">'+
      '<div><span>Status</span><strong>'+esc(draft.status)+'</strong></div>'+
      '<div><span>Public plans</span><strong>'+(draft.plans||[]).filter(function(plan){return plan.status==="published"}).length+'</strong></div>'+
      '<div><span>Slug</span><strong>'+esc(draft.slug)+'</strong></div>'+
      '<div><span>Last updated</span><strong>'+esc(formatDate(draft.updatedAt))+'</strong></div>'+
      '</div></div>'+
    '</section>';
  }

  function renderSidebar(){
    var image=cover(draft.gallery);
    var planCount=(draft.plans||[]).length;
    return '<div class="editor-sidebar-card"><h3>Publish</h3><span class="status-badge status-'+esc(draft.status||"draft")+'">'+esc(draft.status||"draft")+'</span><p style="color:var(--muted);font-size:13px">Last updated '+esc(formatDate(draft.updatedAt))+'</p><span><span class="unsaved-dot"></span> '+(dirty?"Unsaved changes":"Saved state")+'</span></div>'+
      '<div class="editor-sidebar-card"><h3>Cover Image</h3><div class="cover-preview">'+(image?'<img src="'+esc(image.src)+'" alt="'+esc(image.alt||draft.name)+'">':'')+'</div><p style="color:var(--muted);font-size:13px">'+(image?esc(image.caption||"Destination cover selected."):"No cover image yet.")+'</p></div>'+
      '<div class="editor-sidebar-card"><h3>Summary</h3><div class="detail-grid" style="grid-template-columns:1fr"><div><span>Region</span><strong>'+esc(draft.region||"Not set")+'</strong></div><div><span>Location</span><strong>'+esc(draft.location&&draft.location.name||"Not set")+'</strong></div><div><span>Tour plans</span><strong>'+planCount+'</strong></div></div></div>'+
      '<div class="sticky-save"><button class="btn success" id="saveDestinationButton" type="button">Save destination</button><button class="btn secondary" type="button" data-action="duplicate-current">Duplicate</button><button class="btn danger" type="button" data-action="delete-current">Delete destination</button></div>';
  }

  function refreshSidebar(){
    var sidebar=$("destinationSidebar");
    if(sidebar)sidebar.innerHTML=renderSidebar();
    var body=$("destinationEditorBody");
    if(body)body.classList.toggle("unsaved",dirty);
  }

  function updateMapPreview(){
    var root=$("mapPreview");
    if(!root)return;
    var src=mapSrc();
    root.innerHTML=src?'<iframe src="'+esc(src)+'" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>':'<div class="map-fallback"><div><strong>No map preview yet.</strong><span>Enter coordinates, an address or an embed URL.</span></div></div>';
  }

  function updateDestinationField(target){
    var field=target.dataset.destField;
    if(!field)return;
    var value=target.type==="checkbox"?target.checked:target.value;
    if(field==="slug")value=slugify(value);
    draft[field]=value;
    if(field==="name"&&!draft.slug)draft.slug=slugify(value);
    setDirty(true);
    refreshSidebar();
  }

  function updateNestedField(target){
    if(target.dataset.locationField){
      draft.location=draft.location||{};
      draft.location[target.dataset.locationField]=target.value;
      if(target.dataset.locationField==="latitude"||target.dataset.locationField==="longitude"){
        if(draft.location.latitude!==""&&draft.location.longitude!==""){
          draft.location.googleMapsUrl="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(draft.location.latitude+","+draft.location.longitude);
          draft.location.googleMapsEmbedUrl="https://www.google.com/maps?q="+encodeURIComponent(draft.location.latitude+","+draft.location.longitude)+"&output=embed";
        }
        updateMapPreview();
      }
      if(target.dataset.locationField==="address"||target.dataset.locationField==="googleMapsEmbedUrl")updateMapPreview();
      setDirty(true);
      refreshSidebar();
    }
    if(target.dataset.seoField){
      draft.seo=draft.seo||{};
      draft.seo[target.dataset.seoField]=target.value;
      setDirty(true);
    }
  }

  function updatePlanField(target){
    var plan=findPlan(target.dataset.planId);
    if(!plan)return;
    if(target.dataset.planField){
      var value=target.value;
      if(["days","nights"].indexOf(target.dataset.planField)>-1)value=Number(value||0);
      plan[target.dataset.planField]=value;
      plan.updatedAt=now();
      setDirty(true);
    }
    if(target.dataset.planListField){
      plan[target.dataset.planListField]=parseLines(target.value);
      plan.updatedAt=now();
      setDirty(true);
    }
  }

  function updateDayField(target){
    var plan=findPlan(target.dataset.planId);
    if(!plan)return;
    var day=(plan.itineraryDays||[]).find(function(item){return item.id===target.dataset.dayId});
    if(!day)return;
    if(target.dataset.dayField){
      day[target.dataset.dayField]=target.value;
      setDirty(true);
    }
    if(target.dataset.dayListField){
      day[target.dataset.dayListField]=parseLines(target.value);
      setDirty(true);
    }
  }

  function imageList(scope,planId){
    if(scope==="destination")return draft.gallery||(draft.gallery=[]);
    var plan=findPlan(planId);
    if(!plan)return [];
    return plan.gallery||(plan.gallery=[]);
  }

  function updateImageField(target){
    var images=imageList(target.dataset.mediaScope,target.dataset.planId);
    var image=images.find(function(item){return item.id===target.dataset.imageId});
    if(!image)return;
    image[target.dataset.imageField]=target.value;
    setDirty(true);
    refreshSidebar();
  }

  function reindex(items){
    items.forEach(function(item,index){item.order=index+1;if(item.dayNumber!=null)item.dayNumber=index+1});
  }

  async function uploadFile(file){
    if(!/^image\/(jpeg|png|webp)$/.test(file.type))throw new Error("Only JPG, PNG and WebP images are supported.");
    if(file.size>8*1024*1024)throw new Error(file.name+" is larger than 8 MB.");
    var dataUrl=await new Promise(function(resolve,reject){
      var reader=new FileReader();
      reader.onerror=function(){reject(new Error("Could not read "+file.name))};
      reader.onload=function(){resolve(reader.result)};
      reader.readAsDataURL(file);
    });
    if(API_ENABLED){
      return (await api("/api/admin/upload",{method:"POST",body:JSON.stringify({filename:file.name,type:file.type,dataUrl:dataUrl})})).url;
    }
    return dataUrl;
  }

  async function uploadTo(scope,planId,files,replaceImageId){
    var list=imageList(scope,planId);
    var status=document.querySelector('[data-upload-status="'+scope+'"]'+(planId?'[data-plan-id="'+planId+'"]':""));
    if(status){status.className="status-line ok";status.textContent="Preparing upload..."}
    try{
      for(var i=0;i<files.length;i++){
        if(status)status.innerHTML='Uploading '+esc(files[i].name)+'<div class="upload-progress"><span style="width:'+Math.round(((i+1)/files.length)*100)+'%"></span></div>';
        var url=await uploadFile(files[i]);
        if(replaceImageId){
          var image=list.find(function(item){return item.id===replaceImageId});
          if(image)image.src=url;
        }else{
          list.push({id:uid("image"),src:url,caption:"",alt:files[i].name.replace(/\.[^.]+$/,""),isCover:list.length===0,order:list.length+1});
        }
      }
      setDirty(true);
      toast("Images uploaded.");
      renderEditor();
    }catch(err){
      if(status){status.className="status-line error";status.textContent=err.message||"Upload failed. Please try again."}
      toast(err.message||"Upload failed. Please try again.","error");
    }
  }

  function bindDropZones(){
    document.querySelectorAll("[data-upload-drop]").forEach(function(zone){
      ["dragenter","dragover"].forEach(function(type){zone.addEventListener(type,function(event){event.preventDefault();zone.classList.add("dragover")})});
      ["dragleave","drop"].forEach(function(type){zone.addEventListener(type,function(event){event.preventDefault();zone.classList.remove("dragover")})});
      zone.addEventListener("drop",function(event){uploadTo(zone.dataset.uploadDrop,zone.dataset.planId,event.dataTransfer.files)});
      zone.addEventListener("keydown",function(event){if(event.key==="Enter"||event.key===" "){event.preventDefault();document.querySelector('[data-media-input="'+zone.dataset.uploadDrop+'"]'+(zone.dataset.planId?'[data-plan-id="'+zone.dataset.planId+'"]':"")).click()}});
    });
  }

  async function saveDraft(){
    clearError();
    if(!draft.name.trim())return showError("Destination name is required.");
    draft.slug=slugify(draft.slug||draft.name);
    draft.updatedAt=now();
    reindex(draft.gallery||[]);
    (draft.plans||[]).forEach(function(plan,index){
      plan.order=index+1;
      plan.updatedAt=now();
      reindex(plan.gallery||[]);
      reindex(plan.itineraryDays||[]);
    });
    var existingIndex=(state.destinations||[]).findIndex(function(destination){return destination.id===draft.id});
    if(existingIndex>-1)state.destinations[existingIndex]=clone(draft);
    else state.destinations.push(clone(draft));
    await saveState();
    setDirty(false);
    refreshSidebar();
    toast("Destination saved successfully.");
  }

  async function duplicateDestination(id){
    var source=findDestination(id);
    if(!source)return;
    var copy=clone(source);
    copy.id=uid("destination");
    copy.name="Copy of "+copy.name;
    copy.slug=slugify("copy-of-"+copy.slug);
    copy.status="draft";
    copy.order=(state.destinations||[]).filter(function(item){return !item.archivedAt}).length+1;
    copy.createdAt=now();
    copy.updatedAt=now();
    (copy.gallery||[]).forEach(function(image){image.id=uid("image")});
    (copy.plans||[]).forEach(function(plan){
      plan.id=uid("plan");
      plan.status="draft";
      plan.createdAt=now();
      plan.updatedAt=now();
      (plan.gallery||[]).forEach(function(image){image.id=uid("image")});
      (plan.itineraryDays||[]).forEach(function(day){day.id=uid("day")});
    });
    state.destinations.push(copy);
    await saveState();
    toast("Destination duplicated.");
    openEditor(copy.id);
  }

  async function softDeleteDestination(id){
    var destination=findDestination(id);
    if(!destination)return;
    var ok=await confirmAction("Delete "+destination.name+"?","This will remove the destination from the public website and hide its associated tour plans and media from normal navigation. The record is archived in the data file.","Delete Destination");
    if(!ok)return;
    destination.archivedAt=now();
    destination.status="unpublished";
    await saveState();
    toast("Destination deleted.");
    if(draft&&draft.id===id){draft=null;closeModal($("destinationEditorModal"))}
  }

  async function toggleDestinationStatus(id){
    var destination=findDestination(id);
    if(!destination)return;
    destination.status=destination.status==="published"?"unpublished":"published";
    destination.updatedAt=now();
    await saveState();
    toast(destination.status==="published"?"Destination published.":"Destination unpublished.");
  }

  async function searchLocation(){
    var input=document.querySelector("[data-location-search-input]");
    var q=input&&input.value.trim();
    if(!q)return toast("Enter a location to search.","error");
    try{
      var result;
      if(API_ENABLED){
        var payload=await api("/api/admin/geocode?q="+encodeURIComponent(q),{headers:{}});
        result=payload.results&&payload.results[0];
      }else{
        var response=await fetch("https://photon.komoot.io/api/?limit=1&q="+encodeURIComponent(q));
        var json=await response.json();
        var feature=json.features&&json.features[0];
        result=feature&&{name:feature.properties.name||q,address:[feature.properties.name,feature.properties.city,feature.properties.country].filter(Boolean).join(", "),latitude:feature.geometry.coordinates[1],longitude:feature.geometry.coordinates[0]};
      }
      if(!result)throw new Error("Location not found.");
      draft.location.name=result.name||q;
      draft.location.address=result.address||q;
      draft.location.latitude=result.latitude;
      draft.location.longitude=result.longitude;
      draft.location.googleMapsUrl="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(result.latitude+","+result.longitude);
      draft.location.googleMapsEmbedUrl="https://www.google.com/maps?q="+encodeURIComponent(result.latitude+","+result.longitude)+"&output=embed";
      setDirty(true);
      renderEditor();
      activeTab="location";
      toast("Location updated.");
    }catch(err){
      toast(err.message||"Location search is unavailable.","error");
    }
  }

  function setCover(scope,planId,imageId){
    var list=imageList(scope,planId);
    list.forEach(function(image){image.isCover=image.id===imageId});
    setDirty(true);
    renderEditor();
  }

  async function deleteImage(scope,planId,imageId){
    var ok=await confirmAction("Delete this image?","This removes the image from this destination or plan gallery. Uploaded files already stored on the server are left in storage for safety.","Delete image");
    if(!ok)return;
    var list=imageList(scope,planId);
    var index=list.findIndex(function(image){return image.id===imageId});
    if(index>-1)list.splice(index,1);
    if(list.length&&!list.some(function(image){return image.isCover}))list[0].isCover=true;
    reindex(list);
    setDirty(true);
    renderEditor();
    toast("Image removed.");
  }

  function addPlan(){
    var plan=createPlan();
    draft.plans=draft.plans||[];
    draft.plans.push(plan);
    openPlanId=plan.id;
    activeTab="plans";
    setDirty(true);
    renderEditor();
  }

  async function deletePlan(planId){
    var plan=findPlan(planId);
    if(!plan)return;
    var ok=await confirmAction("Delete this tour plan?","This removes the plan from the destination and the public website. Save the destination to persist the change.","Delete tour plan");
    if(!ok)return;
    draft.plans=draft.plans.filter(function(item){return item.id!==planId});
    reindex(draft.plans);
    openPlanId=null;
    setDirty(true);
    renderEditor();
  }

  function duplicatePlan(planId){
    var plan=findPlan(planId);
    if(!plan)return;
    var copy=clone(plan);
    copy.id=uid("plan");
    copy.name="Copy of "+copy.name;
    copy.status="draft";
    copy.order=(draft.plans||[]).length+1;
    copy.createdAt=now();
    copy.updatedAt=now();
    (copy.gallery||[]).forEach(function(image){image.id=uid("image")});
    (copy.itineraryDays||[]).forEach(function(day){day.id=uid("day")});
    draft.plans.push(copy);
    openPlanId=copy.id;
    setDirty(true);
    renderEditor();
  }

  function togglePlanStatus(planId){
    var plan=findPlan(planId);
    if(!plan)return;
    plan.status=plan.status==="published"?"unpublished":"published";
    plan.updatedAt=now();
    setDirty(true);
    renderEditor();
  }

  function addDay(planId){
    var plan=findPlan(planId);
    if(!plan)return;
    plan.itineraryDays=plan.itineraryDays||[];
    plan.itineraryDays.push(createDay(plan.itineraryDays.length+1));
    setDirty(true);
    renderEditor();
  }

  async function deleteDay(planId,dayId){
    var plan=findPlan(planId);
    if(!plan)return;
    var ok=await confirmAction("Delete itinerary day?","This day will be removed from the tour plan. Save the destination to persist the change.","Delete day");
    if(!ok)return;
    plan.itineraryDays=plan.itineraryDays.filter(function(day){return day.id!==dayId});
    reindex(plan.itineraryDays);
    setDirty(true);
    renderEditor();
  }

  function duplicateDay(planId,dayId){
    var plan=findPlan(planId);
    if(!plan)return;
    var day=(plan.itineraryDays||[]).find(function(item){return item.id===dayId});
    if(!day)return;
    var copy=clone(day);
    copy.id=uid("day");
    copy.title="Copy of "+copy.title;
    copy.order=(plan.itineraryDays||[]).length+1;
    plan.itineraryDays.push(copy);
    reindex(plan.itineraryDays);
    setDirty(true);
    renderEditor();
  }

  function reorderArray(items,fromId,toId,idField){
    var from=items.findIndex(function(item){return item[idField]===fromId});
    var to=items.findIndex(function(item){return item[idField]===toId});
    if(from<0||to<0||from===to)return false;
    var moved=items.splice(from,1)[0];
    items.splice(to,0,moved);
    reindex(items);
    return true;
  }

  function bindEvents(){
    ["destinationSearch","destinationStatusFilter","destinationSort"].forEach(function(id){
      $(id).addEventListener("input",renderDestinations);
      $(id).addEventListener("change",renderDestinations);
    });
    $("resetDestinationFilters").addEventListener("click",function(){
      $("destinationSearch").value="";
      $("destinationStatusFilter").value="all";
      $("destinationSort").value="custom";
      renderDestinations();
    });
    $("addDestinationButton").addEventListener("click",function(){openEditor()});
    ["planSearch","planStatusFilter","planSort"].forEach(function(id){
      $(id).addEventListener("input",renderPlansIndex);
      $(id).addEventListener("change",renderPlansIndex);
    });
    $("resetPlanFilters").addEventListener("click",function(){
      $("planSearch").value="";
      $("planStatusFilter").value="all";
      $("planSort").value="destination";
      renderPlansIndex();
    });
    $("destinationCards").addEventListener("click",function(event){
      var card=event.target.closest("[data-destination-id]");
      if(!card)return;
      var destinationId=card.dataset.destinationId;
      var action=event.target.closest("[data-action]");
      if(!action)return;
      if(action.dataset.action==="menu"){
        document.querySelectorAll(".more-menu.open").forEach(function(menu){if(!action.parentElement.contains(menu))menu.classList.remove("open")});
        action.parentElement.querySelector(".more-menu").classList.toggle("open");
      }
      if(action.dataset.action==="edit")openEditor(destinationId);
      if(action.dataset.action==="view")window.open("../../index.html?destination="+encodeURIComponent((findDestination(destinationId)||{}).slug||destinationId)+"#places","_blank");
      if(action.dataset.action==="duplicate")duplicateDestination(destinationId);
      if(action.dataset.action==="toggle-publish")toggleDestinationStatus(destinationId);
      if(action.dataset.action==="delete")softDeleteDestination(destinationId);
    });
    $("destinationCards").addEventListener("dragstart",function(event){
      var card=event.target.closest("[data-destination-id]");
      if(!card||!canDragDestinations()){event.preventDefault();return}
      dragInfo={type:"destination",id:card.dataset.destinationId};
      card.classList.add("dragging");
    });
    $("destinationCards").addEventListener("dragend",function(event){
      var card=event.target.closest("[data-destination-id]");
      if(card)card.classList.remove("dragging");
      dragInfo=null;
    });
    $("destinationCards").addEventListener("dragover",function(event){if(dragInfo&&dragInfo.type==="destination")event.preventDefault()});
    $("destinationCards").addEventListener("drop",async function(event){
      var target=event.target.closest("[data-destination-id]");
      if(!target||!dragInfo||dragInfo.type!=="destination")return;
      if(reorderArray(state.destinations,dragInfo.id,target.dataset.destinationId,"id")){
        await saveState();
        toast("Destination order updated.");
      }
    });
    $("tourCards").addEventListener("click",function(event){
      var btn=event.target.closest("[data-edit-plan]");
      if(btn)openEditor(btn.dataset.destinationId,btn.dataset.editPlan);
    });
    $("closeDestinationEditor").addEventListener("click",closeEditor);
    $("destinationEditorModal").addEventListener("click",function(event){if(event.target===$("destinationEditorModal"))closeEditor()});
    window.addEventListener("beforeunload",function(event){if(dirty){event.preventDefault();event.returnValue=""}});
    document.addEventListener("click",function(event){if(!event.target.closest(".more-wrap"))document.querySelectorAll(".more-menu.open").forEach(function(menu){menu.classList.remove("open")})});

    $("destinationEditorBody").addEventListener("click",function(event){
      var tab=event.target.closest("[data-editor-tab]");
      if(tab){activeTab=tab.dataset.editorTab;renderEditor();return}
      var action=event.target.closest("[data-action]");
      if(!action)return;
      var act=action.dataset.action;
      if(act==="browse-media")document.querySelector('[data-media-input="'+action.dataset.scope+'"]'+(action.dataset.planId?'[data-plan-id="'+action.dataset.planId+'"]':"")).click();
      if(act==="search-location")searchLocation();
      if(act==="set-cover")setCover(action.dataset.scope,action.dataset.planId,action.dataset.imageId);
      if(act==="replace-image")document.querySelector('[data-replace-input="'+action.dataset.imageId+'"]').click();
      if(act==="delete-image")deleteImage(action.dataset.scope,action.dataset.planId,action.dataset.imageId);
      if(act==="add-plan")addPlan();
      if(act==="toggle-plan"){openPlanId=openPlanId===action.dataset.planId?null:action.dataset.planId;activeTab="plans";renderEditor()}
      if(act==="duplicate-plan")duplicatePlan(action.dataset.planId);
      if(act==="toggle-plan-publish")togglePlanStatus(action.dataset.planId);
      if(act==="delete-plan")deletePlan(action.dataset.planId);
      if(act==="add-day")addDay(action.dataset.planId);
      if(act==="delete-day")deleteDay(action.dataset.planId,action.dataset.dayId);
      if(act==="duplicate-day")duplicateDay(action.dataset.planId,action.dataset.dayId);
      if(act==="duplicate-current"){saveDraft().then(function(){duplicateDestination(draft.id)})}
      if(act==="delete-current")softDeleteDestination(draft.id);
    });
    $("destinationEditorBody").addEventListener("input",function(event){
      updateDestinationField(event.target);
      updateNestedField(event.target);
      updatePlanField(event.target);
      updateDayField(event.target);
      updateImageField(event.target);
      clearError();
    });
    $("destinationEditorBody").addEventListener("change",function(event){
      updateDestinationField(event.target);
      updateNestedField(event.target);
      updatePlanField(event.target);
      updateDayField(event.target);
      updateImageField(event.target);
      if(event.target.matches("[data-media-input]"))uploadTo(event.target.dataset.mediaInput,event.target.dataset.planId,event.target.files);
      if(event.target.matches("[data-replace-input]"))uploadTo(event.target.dataset.mediaScope,event.target.dataset.planId,event.target.files,event.target.dataset.replaceInput);
    });
    $("destinationEditorBody").addEventListener("dragstart",function(event){
      var media=event.target.closest(".media-tile");
      var plan=event.target.closest("[data-plan-card]");
      var day=event.target.closest("[data-day-id]");
      if(media){dragInfo={type:"image",id:media.dataset.imageId,scope:media.dataset.mediaScope,planId:media.dataset.planId};media.classList.add("dragging")}
      else if(day){dragInfo={type:"day",id:day.dataset.dayId,planId:day.dataset.planId};day.classList.add("dragging")}
      else if(plan){dragInfo={type:"plan",id:plan.dataset.planCard};plan.classList.add("dragging")}
    });
    $("destinationEditorBody").addEventListener("dragend",function(event){
      var item=event.target.closest(".dragging");
      if(item)item.classList.remove("dragging");
      dragInfo=null;
    });
    $("destinationEditorBody").addEventListener("dragover",function(event){if(dragInfo)event.preventDefault()});
    $("destinationEditorBody").addEventListener("drop",function(event){
      if(!dragInfo)return;
      if(dragInfo.type==="image"){
        var imageTarget=event.target.closest(".media-tile");
        if(!imageTarget)return;
        var list=imageList(dragInfo.scope,dragInfo.planId);
        if(reorderArray(list,dragInfo.id,imageTarget.dataset.imageId,"id")){setDirty(true);renderEditor()}
      }
      if(dragInfo.type==="plan"){
        var planTarget=event.target.closest("[data-plan-card]");
        if(planTarget&&reorderArray(draft.plans,dragInfo.id,planTarget.dataset.planCard,"id")){setDirty(true);renderEditor()}
      }
      if(dragInfo.type==="day"){
        var dayTarget=event.target.closest("[data-day-id]");
        var plan=findPlan(dragInfo.planId);
        if(dayTarget&&plan&&reorderArray(plan.itineraryDays,dragInfo.id,dayTarget.dataset.dayId,"id")){setDirty(true);renderEditor()}
      }
    });
    $("destinationEditorBody").addEventListener("click",function(event){
      if(event.target&&event.target.id==="saveDestinationButton")saveDraft().catch(function(err){showError(err.message||"Could not save destination.")});
    });
  }

  async function init(){
    if(!$("destinationCards"))return;
    bindEvents();
    if(await verifySession())await loadData();
  }

  init();
})();
