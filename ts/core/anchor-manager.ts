import {Endpoint} from "./endpoint/endpoint-impl"
import {
    Dictionary,
    ExtendedOffset,
    Offset,
    PointArray,
    PointXY,
    SortFunction
} from "./common"
import { JsPlumbInstance } from "../core"
import {Connection} from "./connector/connection-impl"
import {Face, Orientation} from "./factory/anchor-factory"
import { DynamicAnchor } from "./anchor/dynamic-anchor"
import {addToList, findWithFunction, removeWithFunction, rotatePoint, rotatePointXY, sortHelper, uuid} from "./util"
import {ContinuousAnchor} from "./anchor/continuous-anchor"
import {Anchor} from "./anchor/anchor"

export type AnchorPlacement = [ number, number, number, number ]
export type ContinuousAnchorPlacement = [ number, number, number, number, Connection, Connection ]
export type AnchorFace = "top" | "right" | "bottom" | "left"

function placeAnchorsOnLine(elementDimensions:PointArray, elementPosition:ExtendedOffset, connections:Array<any>, horizontal:boolean, otherMultiplier:number, reverse:boolean, rotation:number):Array<ContinuousAnchorPlacement> {
    let a:Array<ContinuousAnchorPlacement> = [], step = elementDimensions[horizontal ? 0 : 1] / (connections.length + 1)

    for (let i = 0; i < connections.length; i++) {
        let val = (i + 1) * step, other = otherMultiplier * elementDimensions[horizontal ? 1 : 0]
        if (reverse) {
            val = elementDimensions[horizontal ? 0 : 1] - val
        }

        let dx = (horizontal ? val : other), x = elementPosition.left + dx, xp = dx / elementDimensions[0]
        let dy = (horizontal ? other : val), y = elementPosition.top + dy, yp = dy / elementDimensions[1]

        if (rotation !== 0) {
            const rotated = rotatePoint([x, y], [elementPosition.centerx, elementPosition.centery], rotation);
            x = rotated[0];
            y = rotated[1];
        }

        a.push([ x, y, xp, yp, connections[i][1], connections[i][2] ])
    }

    return a
}

function rightAndBottomSort (a:AnchorListEntry, b:AnchorListEntry):number {
    return b[0][0] - a[0][0]
}

    // used by edgeSortFunctions
function leftAndTopSort(a:AnchorListEntry, b:AnchorListEntry):number {
    let p1 = a[0][0] < 0 ? -Math.PI - a[0][0] : Math.PI - a[0][0],
        p2 = b[0][0] < 0 ? -Math.PI - b[0][0] : Math.PI - b[0][0]

    return p1 - p2
}

// used by placeAnchors
const edgeSortFunctions:Dictionary<SortFunction<AnchorListEntry>> = {
    "top": leftAndTopSort,
    "right": rightAndBottomSort,
    "bottom": rightAndBottomSort,
    "left": leftAndTopSort
}

interface ConnectionFacade {
    endpoints: [ Endpoint, Endpoint ],
    paint:() => any
}

interface OrientationResult {
    orientation?:string,
    a:[Face, Face],
    theta?:number,
    theta2?:number
}

// internal data models for the anchor manager
type AnchorListEntry = [ PointArray, Connection, boolean, string, string ]
type AnchorLists = { top: Array<AnchorListEntry>, right: Array<AnchorListEntry>, bottom: Array<AnchorListEntry>, left: Array<AnchorListEntry> }
type AnchorDictionary = Dictionary<AnchorLists>

export class AnchorManager {
    _amEndpoints:Dictionary<Array<Endpoint>> = {}

    continuousAnchorLocations:Dictionary<[number, number, number, number]> = {}
    continuousAnchorOrientations:Dictionary<Orientation> = {}

    private anchorLists:AnchorDictionary = {}

    private floatingConnections:Dictionary<Connection> = {}

    constructor(private instance:JsPlumbInstance) { }

    reset () {
        this._amEndpoints = {}
        this.anchorLists = {}
    }

    private placeAnchors (instance:JsPlumbInstance, elementId:string, _anchorLists:AnchorLists):void {
        let cd = instance.getCachedData(elementId), sS = cd.s, sO = cd.o,
            placeSomeAnchors = (desc:string, elementDimensions:PointArray, elementPosition:ExtendedOffset, unsortedConnections:Array<AnchorListEntry>, isHorizontal:boolean, otherMultiplier:number, orientation:Orientation) => {
                if (unsortedConnections.length > 0) {
                    let sc = sortHelper(unsortedConnections, edgeSortFunctions[desc]), // puts them in order based on the target element's pos on screen
                        reverse = desc === "right" || desc === "top",
                        rotation = instance.getRotation(elementId),
                        anchors = placeAnchorsOnLine(elementDimensions,
                            elementPosition, sc,
                            isHorizontal,
                            otherMultiplier,
                            reverse,
                            rotation)

                    // takes a computed anchor position and adjusts it for parent offset and scroll, then stores it.
                    let _setAnchorLocation = (endpoint:Endpoint, anchorPos:ContinuousAnchorPlacement) => {
                        this.continuousAnchorLocations[endpoint.id] = [ anchorPos[0], anchorPos[1], anchorPos[2], anchorPos[3] ]
                        this.continuousAnchorOrientations[endpoint.id] = orientation
                    }

                    for (let i = 0; i < anchors.length; i++) {
                        let c = anchors[i][4], weAreSource = c.endpoints[0].elementId === elementId, weAreTarget = c.endpoints[1].elementId === elementId
                        if (weAreSource) {
                            _setAnchorLocation(c.endpoints[0], anchors[i])
                        }
                        if (weAreTarget) {
                            _setAnchorLocation(c.endpoints[1], anchors[i])
                        }
                    }
                }
            }

        placeSomeAnchors("bottom", sS, sO, _anchorLists.bottom, true, 1, [0, 1])
        placeSomeAnchors("top", sS, sO, _anchorLists.top, true, 0, [0, -1])
        placeSomeAnchors("left", sS, sO, _anchorLists.left, false, 0, [-1, 0])
        placeSomeAnchors("right", sS, sO, _anchorLists.right, false, 1, [1, 0])
    }

    clearContinuousAnchorPlacement(endpointId:string) {
        delete this.continuousAnchorLocations[endpointId]
    }

    addFloatingConnection (key:string, conn:Connection) {
        this.floatingConnections[key] = conn
    }
    removeFloatingConnection (key:string) {
        delete this.floatingConnections[key]
    }

    newConnection (conn:Connection):void {
        let sourceId = conn.sourceId, targetId = conn.targetId,
            ep = conn.endpoints,
            doRegisterTarget = true,
            registerConnection = (otherIndex:number, otherEndpoint:Endpoint, otherAnchor:Anchor) => {
                if ((sourceId === targetId) && otherAnchor.isContinuous) {
                    // remove the target endpoint's canvas.  we dont need it.
                    this.instance.renderer.destroyEndpoint(ep[1])
                    doRegisterTarget = false
                }
            }

        registerConnection(0, ep[0], ep[0].anchor)
        if (doRegisterTarget) {
            registerConnection(1, ep[1], ep[1].anchor)
        }
    }

    removeEndpointFromAnchorLists (endpoint:Endpoint):void {
        (function (list, eId) {
            if (list) {  // transient anchors dont get entries in this list.
                let f = (e:AnchorListEntry) => {
                    return e[4] === eId
                }
                removeWithFunction(list.top, f)
                removeWithFunction(list.left, f)
                removeWithFunction(list.bottom, f)
                removeWithFunction(list.right, f)
            }
        })(this.anchorLists[endpoint.elementId], endpoint.id)
    }

    connectionDetached (connection:Connection) {

        if (connection.floatingId) {
            this.removeEndpointFromAnchorLists(connection.floatingEndpoint)
        }

        // remove from anchorLists
        this.removeEndpointFromAnchorLists(connection.endpoints[0])
        this.removeEndpointFromAnchorLists(connection.endpoints[1])
    }

    addEndpoint (endpoint:Endpoint, elementId:string) {
        addToList(this._amEndpoints, elementId, endpoint)
    }

    changeId (oldId:string, newId:string) {
        this._amEndpoints[newId] = this._amEndpoints[oldId]
        delete this._amEndpoints[oldId]
    }

    deleteEndpoint (endpoint:Endpoint) {
        removeWithFunction(this._amEndpoints[endpoint.elementId], function (e) {
            return e.id === endpoint.id
        })
        this.removeEndpointFromAnchorLists(endpoint)
    }

    clearFor (elementId:string) {
        delete this._amEndpoints[elementId]
        this._amEndpoints[elementId] = []
    }
    // updates the given anchor list by either updating an existing anchor's info, or adding it. this function
    // also removes the anchor from its previous list, if the edge it is on has changed.
    // all connections found along the way (those that are connected to one of the faces this function
    // operates on) are added to the connsToPaint list, as are their endpoints. in this way we know to repaint
    // them wthout having to calculate anything else about them.
    private _updateAnchorList (lists:AnchorLists, theta:number, order:number, conn:ConnectionFacade, aBoolean:boolean, otherElId:string, idx:number, reverse:boolean, edgeId:string, connsToPaint:Set<Connection>, endpointsToPaint:Set<Endpoint>) {
        // first try to find the exact match, but keep track of the first index of a matching element id along the way.s
        let exactIdx = -1,
            firstMatchingElIdx = -1,
            endpoint = conn.endpoints[idx],
            endpointId = endpoint.id,
            oIdx = [1, 0][idx],
            values = [
                [ theta, order ],
                conn,
                aBoolean,
                otherElId,
                endpointId
            ],
            listToAddTo = lists[edgeId],
            listToRemoveFrom = (endpoint as any)._continuousAnchorEdge ? lists[(endpoint as any)._continuousAnchorEdge] : null,
            candidate:Connection

        if (listToRemoveFrom) {
            let rIdx = findWithFunction(listToRemoveFrom, function (e) {
                return e[4] === endpointId
            })
            if (rIdx !== -1) {
                listToRemoveFrom.splice(rIdx, 1)
                // get all connections from this list
                for (let i = 0; i < listToRemoveFrom.length; i++) {
                    candidate = listToRemoveFrom[i][1]

                    connsToPaint.add(candidate)
                    endpointsToPaint.add(listToRemoveFrom[i][1].endpoints[idx])
                    endpointsToPaint.add(listToRemoveFrom[i][1].endpoints[oIdx])
                }
            }
        }

        for (let i = 0; i < listToAddTo.length; i++) {
            candidate = listToAddTo[i][1]

            connsToPaint.add(candidate)

            endpointsToPaint.add(listToAddTo[i][1].endpoints[idx])
            endpointsToPaint.add(listToAddTo[i][1].endpoints[oIdx])
        }
        if (exactIdx !== -1) {
            listToAddTo[exactIdx] = values
        }
        else {
            let insertIdx = reverse ? firstMatchingElIdx !== -1 ? firstMatchingElIdx : 0 : listToAddTo.length; // of course we will get this from having looked through the array shortly.
            listToAddTo.splice(insertIdx, 0, values)
        }

        // store this for next time.
        (endpoint as any)._continuousAnchorEdge = edgeId
    }

    //
    // moves the given endpoint from `currentId` to `element`.
    // This involves:
    //
    // 1. changing the key in _amEndpoints under which the endpoint is stored
    // 2. changing the source or target values in all of the endpoint's connections
    // 3. changing the array in connectionsByElementId in which the endpoint's connections
    //    are stored (done by either sourceChanged or updateOtherEndpoint)
    //
    rehomeEndpoint (ep:Endpoint, currentId:string, element:any) {
        let eps = this._amEndpoints[currentId] || [],
            elementId = this.instance.getId(element)

        if (elementId !== currentId) {
            let idx = eps.indexOf(ep)
            if (idx > -1) {
                let _ep = eps.splice(idx, 1)[0]
                this.addEndpoint(_ep, elementId)
            }
        }

        for (let i = 0; i < ep.connections.length; i++) {
            this.instance.sourceOrTargetChanged(currentId,
                ep.elementId,
                ep.connections[i],
                ep.element,
                ep.connections[i].sourceId === currentId ? 0 : 1
            )
        }
    }

    redraw (elementId:string, ui?:Offset, timestamp?:string, offsetToUI?:Offset) {

        if (!this.instance._suspendDrawing) {

            let connectionsToPaint:Set<Connection> = new Set(),
                endpointsToPaint:Set<Endpoint> = new Set(),
                anchorsToUpdate:Set<string> = new Set()

            // get all the endpoints for this element
            let ep = this._amEndpoints[elementId] || []

            timestamp = timestamp || uuid()
            // offsetToUI are values that would have been calculated in the dragManager when registering
            // an endpoint for an element that had a parent (somewhere in the hierarchy) that had been
            // registered as draggable.
            offsetToUI = offsetToUI || {left: 0, top: 0}
            if (ui) {
                ui = {
                    left: ui.left + offsetToUI.left,
                    top: ui.top + offsetToUI.top
                }
            }

            // valid for one paint cycle.
            let myOffset = this.instance.updateOffset({ elId: elementId, offset: ui, recalc: false, timestamp: timestamp }),
                orientationCache = {}

            for(let anEndpoint of ep) {

                endpointsToPaint.add(anEndpoint)

                if (anEndpoint.connections.length === 0) {
                    if (anEndpoint.anchor.isContinuous) {
                        if (!this.anchorLists[elementId]) {
                            this.anchorLists[elementId] = { top: [], right: [], bottom: [], left: [] }
                        }
                        this._updateAnchorList(
                            this.anchorLists[elementId],
                            -Math.PI / 2,
                            0,
                            {endpoints: [anEndpoint, anEndpoint], paint: function () { }},
                            false,
                            elementId,
                            0,
                            false,
                            (<ContinuousAnchor>anEndpoint.anchor).getDefaultFace(),
                            connectionsToPaint,
                            endpointsToPaint)
                        anchorsToUpdate.add(elementId)
                    }

                } else {
                    for (let i = 0; i < anEndpoint.connections.length; i++) {
                        let conn = anEndpoint.connections[i],
                            sourceId = conn.sourceId,
                            targetId = conn.targetId,
                            sourceContinuous = conn.endpoints[0].anchor.isContinuous,
                            targetContinuous = conn.endpoints[1].anchor.isContinuous

                        if (sourceContinuous || targetContinuous) {
                            let oKey = sourceId + "_" + targetId,
                                o = orientationCache[oKey],
                                oIdx = conn.sourceId === elementId ? 1 : 0

                            if (sourceContinuous && !this.anchorLists[sourceId]) {
                                this.anchorLists[sourceId] = { top: [], right: [], bottom: [], left: [] }
                            }
                            if (targetContinuous && !this.anchorLists[targetId]) {
                                this.anchorLists[targetId] = { top: [], right: [], bottom: [], left: [] }
                            }

                            if (elementId !== targetId) {
                                this.instance.updateOffset({ elId: targetId, timestamp: timestamp })
                            }
                            if (elementId !== sourceId) {
                                this.instance.updateOffset({ elId: sourceId, timestamp: timestamp })
                            }

                            let td = this.instance.getCachedData(targetId),
                                sd = this.instance.getCachedData(sourceId)

                            if (targetId === sourceId && (sourceContinuous || targetContinuous)) {
                                // here we may want to improve this by somehow determining the face we'd like
                                // to put the connector on.  ideally, when drawing, the face should be calculated
                                // by determining which face is closest to the point at which the mouse button
                                // was released.  for now, we're putting it on the top face.
                                this._updateAnchorList( this.anchorLists[sourceId], -Math.PI / 2, 0, conn, false, targetId, 0, false, "top", connectionsToPaint, endpointsToPaint)
                                this._updateAnchorList( this.anchorLists[targetId], -Math.PI / 2, 0, conn, false, sourceId, 1, false, "top", connectionsToPaint, endpointsToPaint)
                            }
                            else {
                                const sourceRotation = this.instance.getRotation(sourceId);
                                const targetRotation = this.instance.getRotation(targetId);

                                if (!o) {
                                    o = this.calculateOrientation(sourceId, targetId, sd.o, td.o,
                                        (conn.endpoints[0].anchor as ContinuousAnchor),
                                        (conn.endpoints[1].anchor as ContinuousAnchor),
                                        sourceRotation,
                                        targetRotation)
                                    orientationCache[oKey] = o
                                }
                                if (sourceContinuous) {
                                    this._updateAnchorList(this.anchorLists[sourceId], o.theta, 0, conn, false, targetId, 0, false, o.a[0], connectionsToPaint, endpointsToPaint)
                                }
                                if (targetContinuous) {
                                    this._updateAnchorList(this.anchorLists[targetId], o.theta2, -1, conn, true, sourceId, 1, true, o.a[1], connectionsToPaint, endpointsToPaint)
                                }
                            }

                            if (sourceContinuous) {
                                anchorsToUpdate.add(sourceId)
                            }
                            if (targetContinuous) {
                                anchorsToUpdate.add(targetId)
                            }

                            connectionsToPaint.add(conn)

                            if ((sourceContinuous && oIdx === 0) || (targetContinuous && oIdx === 1)) {
                                endpointsToPaint.add(conn.endpoints[oIdx])
                            }
                        }
                        else {
                            let otherEndpoint = anEndpoint.connections[i].endpoints[conn.sourceId === elementId ? 1 : 0]

                            if (otherEndpoint.anchor.constructor === DynamicAnchor) {

                                otherEndpoint.paint({ elementWithPrecedence: elementId, timestamp: timestamp })

                                connectionsToPaint.add(anEndpoint.connections[i])

                                // all the connections for the other endpoint now need to be repainted
                                for (let k = 0; k < otherEndpoint.connections.length; k++) {
                                    if (otherEndpoint.connections[k] !== anEndpoint.connections[i]) {
                                        connectionsToPaint.add(otherEndpoint.connections[k])
                                    }
                                }
                            } else {
                                connectionsToPaint.add(anEndpoint.connections[i])
                            }
                        }
                    }
                }
            }

            // now place all the continuous anchors we need to
            for (let anchor of anchorsToUpdate) {
                this.placeAnchors(this.instance, anchor, this.anchorLists[anchor])
            }

            // now that continuous anchors have been placed, paint all the endpoints for this element and any other endpoints we came across as a result of the continuous anchors.
            for (let ep of endpointsToPaint) {
                let cd = this.instance.getCachedData(ep.elementId)
                ep.paint({ timestamp: timestamp, offset: cd, dimensions: cd.s, rotation:cd.r })
            }

            // paint current floating connection for this element, if there is one.
            let fc = this.floatingConnections[elementId]
            if (fc) {
                fc.paint({timestamp: timestamp, recalc: false, elId: elementId})
            }

            // paint all the connections
            for (let c of connectionsToPaint) {
                c.paint({elId: elementId, timestamp: timestamp, recalc: false})
            }
        }
    }


    calculateOrientation (sourceId:string, targetId:string,
                          sd:ExtendedOffset, td:ExtendedOffset,
                          sourceAnchor:ContinuousAnchor,
                          targetAnchor:ContinuousAnchor,
                          sourceRotation:number,
                          targetRotation:number):OrientationResult {

        let Orientation = { HORIZONTAL: "horizontal", VERTICAL: "vertical", DIAGONAL: "diagonal", IDENTITY: "identity" }

        if (sourceId === targetId) {
            return {
                orientation: Orientation.IDENTITY,
                a: ["top", "top"]
            }
        }

        // since we only support rotation around the center of an element these two lines don't have to take rotation
        // into account.
        let theta = Math.atan2((td.centery - sd.centery), (td.centerx - sd.centerx)),
            theta2 = Math.atan2((sd.centery - td.centery), (sd.centerx - td.centerx))

// --------------------------------------------------------------------------------------

        // improved face calculation. get midpoints of each face for source and target, then put in an array with all combinations of
        // source/target faces. sort this array by distance between midpoints. the entry at index 0 is our preferred option. we can
        // go through the array one by one until we find an entry in which each requested face is supported.
        let candidates:Array<{source:Face, target:Face, dist:number}> = [], midpoints:Dictionary<{
            top:PointXY,
            left:PointXY,
            right:PointXY,
            bottom:PointXY
        }> = { }
        ;(function (types:Array<string>, dim:Array<[ExtendedOffset, number]>) {
            for (let i = 0; i < types.length; i++) {
                midpoints[types[i]] = {
                    "left": {x:dim[i][0].left, y:dim[i][0].centery },
                    "right": {x:dim[i][0].right, y:dim[i][0].centery },
                    "top": {x:dim[i][0].centerx, y:dim[i][0].top },
                    "bottom": {x:dim[i][0].centerx , y:dim[i][0].bottom}
                }

                if (dim[i][1] !== 0) {
                    for (let axis in midpoints[types[i]]) {
                        midpoints[types[i]][axis] = rotatePointXY(midpoints[types[i]][axis], {x:dim[i][0].centerx, y:dim[i][0].centery}, dim[i][1]);
                    }
                }

            }
        })([ "source", "target" ], [ [ sd, sourceRotation], [td, targetRotation] ])

        let FACES:Array<Face> = [ "top", "right", "left", "bottom" ]

        for (let sf = 0; sf < FACES.length; sf++) {
            for (let tf = 0; tf < FACES.length; tf++) {
                candidates.push({
                    source: FACES[sf],
                    target: FACES[tf],
                    dist: this.instance.geometry.lineLength(midpoints.source[FACES[sf]], midpoints.target[FACES[tf]])
                })
            }
        }

        candidates.sort(function (a, b) {
            if (a.dist < b.dist) {
                return -1
            } else if (b.dist < a.dist) {
                return 1
            } else {
                const axisIndices = {
                    "left":0,
                    "top":1,
                    "right":2,
                    "bottom":3
                },
                    ais = axisIndices[a.source],
                    bis = axisIndices[b.source],
                    ait = axisIndices[a.target],
                    bit = axisIndices[b.target]

                return ais < bis ? -1 : bis < ais ? 1 : ait < bit ? -1 : bit < ait ? 1 : 0
            }
        })

        // now go through this list and try to get an entry that satisfies both (there will be one, unless one of the anchors
        // declares no available faces)
        let sourceEdge = candidates[0].source, targetEdge = candidates[0].target
        for (let i = 0; i < candidates.length; i++) {

            if (sourceAnchor.isContinuous && sourceAnchor.locked) {
                sourceEdge = sourceAnchor.getCurrentFace()
            }
            else if (!sourceAnchor.isContinuous || sourceAnchor.isEdgeSupported(candidates[i].source)) {
                sourceEdge = candidates[i].source
            }
            else {
                sourceEdge = null
            }

            if (targetAnchor.isContinuous && targetAnchor.locked) {
                targetEdge = targetAnchor.getCurrentFace()
            }
            else if (!targetAnchor.isContinuous || targetAnchor.isEdgeSupported(candidates[i].target)) {
                targetEdge = candidates[i].target
            }
            else {
                targetEdge = null
            }

            if (sourceEdge != null && targetEdge != null) {
                break
            }
        }

        if (sourceAnchor.isContinuous) {
            sourceAnchor.setCurrentFace(sourceEdge)
        }

        if (targetAnchor.isContinuous) {
            targetAnchor.setCurrentFace(targetEdge)
        }

// --------------------------------------------------------------------------------------

        return {
            a: [ sourceEdge, targetEdge ],
            theta: theta,
            theta2: theta2
        }
    }
}


