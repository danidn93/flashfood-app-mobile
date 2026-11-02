import Foundation
import ActivityKit

// Shared with the Widget Extension target in Xcode.
@available(iOS 16.1, *)
struct FlashFoodOrderAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var status: String
        var headline: String
        var updatedAt: Date
        var estimatedArrival: Date?
    }

    var orderId: String
    var orderNumber: String
    var merchantName: String
}
