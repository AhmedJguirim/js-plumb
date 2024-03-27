jsPlumb.ready(function () {

    var instance = jsPlumb.newInstance({
        connector: "Straight",
        paintStyle: { strokeWidth: 3, stroke: "#ffa500", "dashstyle": "2 4" },
        endpoint: { type:"Dot", options:{ radius: 5 } },
        endpointStyle: { fill: "#ffa500" },
        container: canvas,
        listStyle:{
            endpoint:{type:"Rectangle", options:{ width:30, height:30 }}
        }
    });

    var listManager = new jsPlumb.JsPlumbListManager(instance)

    window.jsp = instance;

    // get the two elements that contain a list inside them
    var list1El = document.querySelector("#list-one"),
        list2El = document.querySelector("#list-two"),
        list1Ul = list1El.querySelector("ul"),
        list2Ul = list2El.querySelector("ul");

    instance.manage(list1El);
    instance.manage(list2El);

    // get uls
    var lists = document.querySelectorAll("ul");

    instance.registerConnectionType("link", {
        anchors: [ ["Left", "Right" ], ["Left", "Right" ] ]
    })

    // suspend drawing and initialise.
    instance.batch(function () {

        var selectedSources = [], selectedTargets = [];

        instance.manageAll(document.querySelectorAll(".list ul li"))

        for (var l = 0; l < lists.length; l++) {
            var isSource = lists[l].getAttribute("source") != null;
            var items = lists[l].querySelectorAll("li");
            for (var i = 0; i < items.length; i++) {
                if (Math.random() < 0.2) {
                    (isSource ? selectedSources : selectedTargets).push(items[i])
                }
            }
        }

        instance.addSourceSelector("[source] li", {
            allowLoopback: false,
            edgeType:"link"
        });

        instance.addTargetSelector("[target] li", {
            anchor: ["Left", "Right" ]
        });

        var connCount = Math.min(selectedSources.length, selectedTargets.length);
        for (var i = 0; i < connCount; i++) {
            instance.connect({source:selectedSources[i], target:selectedTargets[i], type:"link"});
        }
    });

    // configure list1Ul manually, as it does not have a `jtk-scrollable-list` attribute, whereas list2Ul does, and is therefore
    // configured automatically.
    listManager.addList(list1Ul, {
        endpoint:{type:"Rectangle", options:{width:20, height:20}}
    });

    instance.bind("click", function(c) { instance.deleteConnection(c); });

    instance.on(document, "change", "[type='checkbox']", function(e) {
        instance[e.srcElement.checked ? "addList" : "removeList"](e.srcElement.value === "list1" ? list1Ul : list2Ul);
    });
});
