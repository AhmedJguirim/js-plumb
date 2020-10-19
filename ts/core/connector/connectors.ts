import {AbstractConnector} from "./abstract-connector"
import {Constructable, Dictionary} from "../common"
import { JsPlumbInstance } from ".."
import {Connection} from "./connection-impl"

const connectorMap:Dictionary<Constructable<AbstractConnector>> = {}

export const Connectors = {
    get:(instance:JsPlumbInstance, connection:Connection, name:string, params:any):AbstractConnector => {

        let c:Constructable<AbstractConnector> = connectorMap[name]
        if (!c) {
            throw {message:"jsPlumb: unknown connector type '" + name + "'"}
        } else {
            return new c(instance, connection, params) as AbstractConnector
        }
    },

    register:(name:string, conn:Constructable<AbstractConnector>) => {
        connectorMap[name] = conn
    }
}



