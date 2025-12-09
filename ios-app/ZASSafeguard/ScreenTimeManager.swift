/**
 * ZAS Safeguard - iOS ScreenTime Manager
 * 
 * Integrates with iOS ScreenTime and Family Controls APIs
 * to manage app restrictions and content filtering.
 * 
 * Requirements:
 * - iOS 15+
 * - Family Controls capability
 * - Screen Time API entitlement
 */

import Foundation
import FamilyControls
import ManagedSettings
import DeviceActivity

@MainActor
class ScreenTimeManager: ObservableObject {
    
    static let shared = ScreenTimeManager()
    
    @Published var isAuthorized = false
    @Published var isMonitoring = false
    @Published var blockedApps: Set<ApplicationToken> = []
    @Published var blockedWebDomains: Set<WebDomainToken> = []
    
    private let authorizationCenter = AuthorizationCenter.shared
    private let store = ManagedSettingsStore()
    private let monitor = DeviceActivityMonitor()
    
    // Default blocked categories
    private let defaultBlockedCategories: Set<ActivityCategoryToken> = []
    
    // MARK: - Authorization
    
    func requestAuthorization() async throws {
        do {
            try await authorizationCenter.requestAuthorization(for: .individual)
            isAuthorized = true
            NSLog("[ZAS] ScreenTime authorization granted")
        } catch {
            isAuthorized = false
            NSLog("[ZAS] ScreenTime authorization failed: \(error)")
            throw error
        }
    }
    
    // MARK: - Content Blocking
    
    /// Apply blocking restrictions
    func applyBlockingRestrictions() {
        guard isAuthorized else {
            NSLog("[ZAS] Not authorized, cannot apply restrictions")
            return
        }
        
        // Shield configuration
        store.shield.applications = blockedApps
        store.shield.webDomains = blockedWebDomains
        store.shield.applicationCategories = .specific(defaultBlockedCategories)
        
        // Web content filtering
        store.webContentSettings.blockedByFilter = .specific(blockedWebDomains)
        
        NSLog("[ZAS] Blocking restrictions applied: \(blockedApps.count) apps, \(blockedWebDomains.count) domains")
    }
    
    /// Remove all restrictions (requires unlock authorization)
    func removeRestrictions() {
        store.shield.applications = nil
        store.shield.webDomains = nil
        store.shield.applicationCategories = nil
        store.webContentSettings.blockedByFilter = .none
        
        NSLog("[ZAS] Blocking restrictions removed")
    }
    
    /// Clear all managed settings
    func clearAllSettings() {
        store.clearAllSettings()
        NSLog("[ZAS] All managed settings cleared")
    }
    
    // MARK: - App Management
    
    /// Block specific app tokens
    func blockApps(_ tokens: Set<ApplicationToken>) {
        blockedApps.formUnion(tokens)
        applyBlockingRestrictions()
    }
    
    /// Unblock specific app tokens
    func unblockApps(_ tokens: Set<ApplicationToken>) {
        blockedApps.subtract(tokens)
        applyBlockingRestrictions()
    }
    
    // MARK: - Web Domain Management
    
    /// Add domains to blocklist
    func blockWebDomains(_ domains: Set<WebDomainToken>) {
        blockedWebDomains.formUnion(domains)
        applyBlockingRestrictions()
    }
    
    // MARK: - Device Activity Monitoring
    
    /// Start monitoring device activity
    func startMonitoring() {
        let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59),
            repeats: true
        )
        
        let activity = DeviceActivityName("ZASSafeguardActivity")
        
        do {
            try DeviceActivityCenter().startMonitoring(activity, during: schedule)
            isMonitoring = true
            NSLog("[ZAS] Device activity monitoring started")
        } catch {
            NSLog("[ZAS] Failed to start monitoring: \(error)")
        }
    }
    
    /// Stop monitoring
    func stopMonitoring() {
        let activity = DeviceActivityName("ZASSafeguardActivity")
        DeviceActivityCenter().stopMonitoring([activity])
        isMonitoring = false
        NSLog("[ZAS] Device activity monitoring stopped")
    }
    
    // MARK: - Firebase Sync
    
    func syncWithFirebase() async {
        // Fetch blocklist from Firebase
        NSLog("[ZAS] Syncing with Firebase...")
        // TODO: Implement Firebase sync
        
        // After sync, reapply restrictions
        applyBlockingRestrictions()
    }
}

// MARK: - Device Activity Monitor Extension

class ZASDeviceActivityMonitor: DeviceActivityMonitor {
    
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        NSLog("[ZAS] Activity interval started: \(activity.rawValue)")
        
        // Apply restrictions at start of interval
        Task { @MainActor in
            ScreenTimeManager.shared.applyBlockingRestrictions()
        }
    }
    
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        NSLog("[ZAS] Activity interval ended: \(activity.rawValue)")
    }
    
    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        NSLog("[ZAS] Event threshold reached: \(event.rawValue)")
    }
}
