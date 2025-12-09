/**
 * ZAS Safeguard - macOS Content Filter
 * 
 * Network Extension Content Filter Provider
 * 
 * Filters network traffic and blocks requests to blocked domains.
 */

import Foundation
import NetworkExtension

class ContentFilterProvider: NEFilterDataProvider {
    
    private var blockedDomains: Set<String> = []
    
    override func startFilter(completionHandler: @escaping (Error?) -> Void) {
        NSLog("[ZAS] Content Filter starting...")
        
        // Load blocklist
        loadBlocklist()
        
        // Configure filter rules
        let filterRules = NEFilterRule(networkRule: NENetworkRule(
            remoteNetwork: nil,
            remotePrefix: 0,
            localNetwork: nil,
            localPrefix: 0,
            protocol: .any,
            direction: .any
        ), action: .filterData)
        
        let filterSettings = NEFilterSettings(rules: [filterRules], defaultAction: .allow)
        
        apply(filterSettings) { error in
            if let error = error {
                NSLog("[ZAS] Error applying filter settings: \(error)")
                completionHandler(error)
            } else {
                NSLog("[ZAS] Content Filter started")
                completionHandler(nil)
            }
        }
    }
    
    override func stopFilter(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        NSLog("[ZAS] Content Filter stopping with reason: \(reason)")
        completionHandler()
    }
    
    override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
        // Check if this flow should be blocked
        guard let socketFlow = flow as? NEFilterSocketFlow,
              let remoteEndpoint = socketFlow.remoteEndpoint as? NWHostEndpoint else {
            return .allow()
        }
        
        let hostname = remoteEndpoint.hostname
        
        if shouldBlock(domain: hostname) {
            NSLog("[ZAS] Blocking flow to: \(hostname)")
            logBlockEvent(domain: hostname, url: flow.url?.absoluteString)
            return .drop()
        }
        
        return .allow()
    }
    
    override func handleInboundData(from flow: NEFilterFlow, readBytesStartOffset: Int, readBytes: Data) -> NEFilterDataVerdict {
        return .allow()
    }
    
    override func handleOutboundData(from flow: NEFilterFlow, readBytesStartOffset: Int, readBytes: Data) -> NEFilterDataVerdict {
        // Could inspect HTTP headers here for additional filtering
        return .allow()
    }
    
    // MARK: - Domain Blocking
    
    private func shouldBlock(domain: String) -> Bool {
        let lowercaseDomain = domain.lowercased()
        
        // Check exact match
        if blockedDomains.contains(lowercaseDomain) {
            return true
        }
        
        // Check parent domains
        let components = lowercaseDomain.split(separator: ".")
        for i in 0..<components.count {
            let parentDomain = components[i...].joined(separator: ".")
            if blockedDomains.contains(parentDomain) {
                return true
            }
        }
        
        return false
    }
    
    private func loadBlocklist() {
        if let appGroup = UserDefaults(suiteName: "group.com.zas.safeguard") {
            if let savedDomains = appGroup.array(forKey: "blockedDomains") as? [String] {
                blockedDomains = Set(savedDomains)
            }
        }
        
        // Always include default porn domains
        let defaults: Set<String> = [
            "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com",
            "redtube.com", "youporn.com", "tube8.com", "spankbang.com"
        ]
        blockedDomains = blockedDomains.union(defaults)
    }
    
    private func logBlockEvent(domain: String, url: String?) {
        NSLog("[ZAS] Block logged: \(domain)")
        // TODO: Send to Firebase
    }
}
