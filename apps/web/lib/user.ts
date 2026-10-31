export type ManageAds = {
  adsId: string;
  title: string;
  description: string;
  price: number;
  oldPrice?: number;
  delivery?: boolean;
  images: string[];
  postCategory: string;
  postCateImage: string;
  location: string;
  createdAt: string;
  like: number;
  share: number;
  totalAds: number;
  status: "active" | "expired" | "pending" | "sold";
  userId: string;
};

export type SaveAds = {
  savedAdsId: string;
  postId: string;
  title: string;
  price: number;
  location: string;
  userId: string;
};

export type LikeAds = {
  likedAdsId: string;
  postId: string;
  title: string;
  price: number;
  location: string;
  userId: string;
};

export type Post = {
  postId: string;
  title: string;
  description: string;
  price: number;
  oldPrice?: number;
  delivery?: boolean;
  images: string[];
  postCategory: string;
  postCateImage: string;
  province: string;
  district: string;
  commune: string;
  createdAt: string;
  like: number;
  share: number;
  userId: string;
};

export type Notification = {
  id: string;
  type: string;
  title: string;
  description: string;
  createdAt: string;
  receiverId: string;
  senderId: string;
  isRead: boolean;
};
export type Chats = {
  chatId: string;
  buyerId: BaseUser;
  sellerId: BaseUser;
  postId: string;
  postCateImage: string;
  postTitle: string;
  postDescription: string;
  postPrice: number;
  postOldPrice?: number;
  postDelivery?: boolean;
  postImages: string[];
  postLocation: string;
  postCreatedAt: string;
  like: number;
  share: number;
  chatDate: string;
};

export type BaseUser = {
  userId: string;
  username: string;
  name: string;
  avatar: string;
  cover: string;
  locations: string;
  following: number;
  follower: number;

  joinDate?: string;
  phone?: string[];
  verified?: boolean;
  /** Paid-plan badge — derived from an active subscription, never stored. */
  verifiedAccount?: boolean;

  userlink?: string;

  /** Employer on a job listing (the form's `company` field), when given. */
  company?: string;

  email?: string;
  google?: string;
  facebook?: string;
  telegram?: string;

  userpost?: Post[];
  notifications?: Notification[];
};
export type User = BaseUser & {
  savedAds?: SaveAds[];
  likedAds?: LikeAds[];
  myAds?: ManageAds[];
  followingUsers?: BaseUser[];
  followerUsers?: BaseUser[];
};
