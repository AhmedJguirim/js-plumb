jsPlumb.ready(function () {

    var instance = jsPlumb.newInstance({
        connector: "StateMachine",
        paintStyle: { strokeWidth: 3, stroke: "#ffa500", "dashstyle": "2 4" },
        endpoint: [ "Dot", { radius: 5 } ],
        endpointStyle: { fill: "#ffa500" },
        container: "canvas"
    });

    var shapes = document.querySelectorAll(".shape");

    // suspend drawing and initialise.
    instance.batch(function () {

        // loop through them and connect each one to each other one.
        for (var i = 0; i < shapes.length; i++) {
            for (var j = i + 1; j < shapes.length; j++) {
                instance.connect({
                    source: shapes[i],  // just pass in the current node in the selector for source
                    target: shapes[j],
                    // here we supply a different anchor for source and for target, and we get the element's "data-shape"
                    // attribute to tell us what shape we should use, as well as, optionally, a rotation value.
                    anchors: [
                        [ "Perimeter", { shape: shapes[i].getAttribute("data-shape"), rotation: shapes[i].getAttribute("data-rotation") }],
                        [ "Perimeter", { shape: shapes[j].getAttribute("data-shape"), rotation: shapes[j].getAttribute("data-rotation") }]
                    ]
                });
            }
        }
    });
});
