/**
 * ZAS Safeguard - iOS DNS Content Filter
 * 
 * Network Extension that filters DNS requests to block
 * harmful domains at the network level.
 * 
 * Requirements:
 * - Network Extension entitlement
 * - Content Filter Provider capability
 */

import Foundation
import NetworkExtension

class FilterDataProvider: NEFilterDataProvider {
    
    private var blockedDomains: Set<String> = []
    
    // Default blocked domains
    private let defaultBlockedDomains: Set<String> = [
        "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com",
        "redtube.com", "youporn.com", "tube8.com", "spankbang.com",
        "porn.com", "brazzers.com", "bangbros.com"
    ]
    
    override func startFilter(completionHandler: @escaping (Error?) -> Void) {
        NSLog("[ZAS] DNS Content Filter starting...")
        
        // Load blocklist
        loadBlocklist()
        
        // Configure filter rules
        let filterRules = NEFilterRule(networkRule: NENetworkRule(
            remoteNetwork: nil,
            remotePrefix: 0,
            localNetwork: nil,
            localPrefix: 0,
            protocol: .any,
            direction: .outbound
        ), action: .filterData)
        
        let filterSettings = NEFilterSettings(rules: [filterRules], defaultAction: .allow)
        
        apply(filterSettings) { error in
            if let error = error {
                NSLog("[ZAS] Error applying filter: \(error)")
                completionHandler(error)
            } else {
                NSLog("[ZAS] DNS Filter applied with \(self.blockedDomains.count) domains")
                completionHandler(nil)
            }
        }
    }
    
    override func stopFilter(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        NSLog("[ZAS] DNS Filter stopping with reason: \(reason)")
        completionHandler()
    }
    
    override func handleNewFlow(_ flow: NEFilterFlow) -> NEFilterNewFlowVerdict {
        // Check if this is a browsing flow
        guard let browserFlow = flow as? NEFilterBrowserFlow else {
            return .allow()
        }
        
        // Get the URL being accessed
        if let url = browserFlow.url,
           let host = url.host {
            
            if shouldBlock(domain: host) {
                NSLog("[ZAS] Blocking: \(host)")
                logBlockEvent(domain: host, url: url.absoluteString)
                return .drop()
            }
        }
        
        return .allow()
    }
    
    override func handleInboundData(from flow: NEFilterFlow, readBytesStartOffset: Int, readBytes: Data) -> NEFilterDataVerdict {
        return .allow()
    }
    
    override func handleOutboundData(from flow: NEFilterFlow, readBytesStartOffset: Int, readBytes: Data) -> NEFilterDataVerdict {
        return .allow()
    }
    
    // MARK: - Domain Blocking
    
    private func shouldBlock(domain: String) -> Bool {
        let lowerDomain = domain.lowercased()
        
        // Check exact match
        if blockedDomains.contains(lowerDomain) {
            return true
        }
        
        // Check parent domains
        let components = lowerDomain.split(separator: ".")
        for i in 0..<components.count {
            let parentDomain = components[i...].joined(separator: ".")
            if blockedDomains.contains(parentDomain) {
                return true
            }
        }
        
        return false
    }
    
    // MARK: - Blocklist Management
    
    private func loadBlocklist() {
        // Load from shared UserDefaults
        if let appGroup = UserDefaults(suiteName: "group.com.zas.safeguard"),
           let savedDomains = appGroup.array(forKey: "blockedDomains") as? [String] {
            blockedDomains = Set(savedDomains)
        }
        
        // Always include default domains
        blockedDomains = blockedDomains.union(defaultBlockedDomains)
        
        NSLog("[ZAS] Blocklist loaded: \(blockedDomains.count) domains")
    }
    
    private func logBlockEvent(domain: String, url: String) {
        NSLog("[ZAS] Block logged: \(domain)")
        
        // Save to UserDefaults for sync
        if let appGroup = UserDefaults(suiteName: "group.com.zas.safeguard") {
            var logs = appGroup.array(forKey: "blockLogs") as? [[String: Any]] ?? []
            logs.append([
                "domain": domain,
                "url": url,
                "timestamp": Date().timeIntervalSince1970
            ])
            
            // Keep only last 100 logs
            if logs.count > 100 {
                logs = Array(logs.suffix(100))
            }
            
            appGroup.set(logs, forKey: "blockLogs")
        }
    }
}

// MARK: - DNS Proxy Provider

class DNSProxyProvider: NEDNSProxyProvider {
    
    private var blockedDomains: Set<String> = []
    
    override func startProxy(options: [String : Any]? = nil, completionHandler: @escaping (Error?) -> Void) {
        NSLog("[ZAS] DNS Proxy starting...")
        loadBlocklist()
        completionHandler(nil)
    }
    
    override func stopProxy(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        NSLog("[ZAS] DNS Proxy stopping")
        completionHandler()
    }
    
    override func handleNewFlow(_ flow: NEAppProxyFlow) -> Bool {
        guard let udpFlow = flow as? NEAppProxyUDPFlow else {
            return false
        }
        
        handleDNSFlow(udpFlow)
        return true
    }
    
    private func handleDNSFlow(_ flow: NEAppProxyUDPFlow) {
        flow.open(withLocalEndpoint: nil) { error in
            if let error = error {
                NSLog("[ZAS] DNS Flow error: \(error)")
                return
            }
            self.readDNSQueries(from: flow)
        }
    }
    
    private func readDNSQueries(from flow: NEAppProxyUDPFlow) {
        flow.readDatagrams { datagrams, endpoints, error in
            guard let datagrams = datagrams, let endpoints = endpoints else { return }
            
            for (index, datagram) in datagrams.enumerated() {
                if let domain = self.extractDomain(from: datagram),
                   self.shouldBlock(domain: domain) {
                    NSLog("[ZAS] Blocking DNS: \(domain)")
                    self.sendNXDomain(for: datagram, to: flow, endpoint: endpoints[index])
                } else {
                    // Forward query
                    flow.writeDatagrams([datagram], sentBy: [endpoints[index]]) { _ in }
                }
            }
            
            self.readDNSQueries(from: flow)
        }
    }
    
    private func extractDomain(from data: Data) -> String? {
        guard data.count > 12 else { return nil }
        
        var domain = ""
        var offset = 12
        
        while offset < data.count {
            let length = Int(data[offset])
            if length == 0 { break }
            
            offset += 1
            guard offset + length <= data.count else { break }
            
            if !domain.isEmpty { domain += "." }
            domain += String(data: data[offset..<(offset + length)], encoding: .utf8) ?? ""
            offset += length
        }
        
        return domain.isEmpty ? nil : domain
    }
    
    private func shouldBlock(domain: String) -> Bool {
        let lower = domain.lowercased()
        return blockedDomains.contains(where: { lower.contains($0) })
    }
    
    private func sendNXDomain(for query: Data, to flow: NEAppProxyUDPFlow, endpoint: NWEndpoint) {
        var response = query
        if response.count >= 4 {
            response[2] = 0x81
            response[3] = 0x83 // NXDOMAIN
        }
        flow.writeDatagrams([response], sentBy: [endpoint]) { _ in }
    }
    
    private func loadBlocklist() {
        if let appGroup = UserDefaults(suiteName: "group.com.zas.safeguard"),
           let domains = appGroup.array(forKey: "blockedDomains") as? [String] {
            blockedDomains = Set(domains)
        }
        blockedDomains.insert("pornhub.com")
        blockedDomains.insert("xvideos.com")
    }
}
